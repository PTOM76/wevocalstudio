// ミキサー（AudioWorklet）の読み込みと、トラックごとのミキサー、音のデータの送り先、波形ブロックから声を作る
import type { Clip } from 'wevocal-lib'
import type { Piece } from '../dsp/pitch'
import type { Block } from '../project'
import type { MixerMessage, Voice } from './types'
import workletUrl from './mixer.worklet.ts?worker&url'

/** かたまりのつなぎ目で重ねる長さ（秒。片ごとに前後へこれだけ伸ばす） */
const XFADE = 0.005

/** AudioContext ごとの読み込み（1 回だけ） */
const loaded = new WeakMap<BaseAudioContext, Promise<void>>()
export const loadMixer = (ctx: BaseAudioContext) => {
  let p = loaded.get(ctx)
  if (!p) loaded.set(ctx, (p = ctx.audioWorklet.addModule(workletUrl)))
  return p
}

/** Clip ごとの番号（音のデータを 1 回だけ送るため、波形ブロックの音が変わったかを比べるため） */
const clipIds = new WeakMap<Clip, number>()
let nextClipId = 1
export const clipId = (c: Clip) => clipIds.get(c) ?? (clipIds.set(c, nextClipId), nextClipId++)

/** 共有のメモリに置いた音のデータ（cross-origin isolation のときだけ。Clip ごとに 1 回だけ作り、どの AudioContext のミキサーにも写さずに渡す） */
const shared = new WeakMap<Clip, Float32Array[]>()
const channelsFor = (c: Clip) => {
  if (!globalThis.crossOriginIsolated) return c.channels
  let ch = shared.get(c)
  if (!ch) {
    ch = c.channels.map((x) => {
      const y = new Float32Array(new SharedArrayBuffer(x.byteLength))
      y.set(x)
      return y
    })
    shared.set(c, ch)
  }
  return ch
}

/** AudioContext ごとに、送った音のデータの id（ミキサーの置き場は AudioContext ごとに 1 つ） */
const sentClips = new WeakMap<BaseAudioContext, Set<number>>()

/** 1 つの再生（Graph）のミキサー。トラックごとに 1 つの AudioWorkletNode を置き、トラックの入口につなぐ */
export class Mixers {
  private readonly nodes = new Map<string, AudioWorkletNode>()
  /** トラックごとに最後に送った声の一覧（同じなら送らない。ドラッグ中は動かしたトラックだけを送る） */
  private readonly sent = new Map<string, string>()
  private readonly ctx: BaseAudioContext
  private pings = 0

  constructor(ctx: BaseAudioContext) {
    this.ctx = ctx
  }

  /** トラックのミキサー（なければ作って dest につなぐ） */
  node(trackId: string, dest: AudioNode) {
    let n = this.nodes.get(trackId)
    if (!n) {
      n = new AudioWorkletNode(this.ctx, 'block-mixer', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] })
      n.connect(dest)
      this.nodes.set(trackId, n)
    }
    return n
  }

  /** 送る先（どのミキサーに送っても、同じ置き場に入る） */
  private any() {
    return this.nodes.values().next().value
  }

  /** まだ送っていない音のデータを送り、使わなくなったものを消す（keep は使っていなくても消さない。元の音を送り直さないため） */
  syncClips(used: Map<number, Clip>, keep: Set<number>) {
    const port = this.any()?.port
    if (!port) return
    let sent = sentClips.get(this.ctx)
    if (!sent) sentClips.set(this.ctx, (sent = new Set()))
    for (const [id, c] of used)
      if (!sent.has(id)) {
        // cross-origin isolation なら共有のメモリを渡す（写さない）。でなければ写して送る（元の音は画面でも使うので渡せない。AudioContext ごとに 1 回だけ）
        port.postMessage({ type: 'clip', id, sampleRate: c.sampleRate, channels: channelsFor(c) } satisfies MixerMessage)
        sent.add(id)
      }
    const gone = [...sent].filter((id) => !used.has(id) && !keep.has(id))
    if (gone.length) {
      port.postMessage({ type: 'unclip', ids: gone } satisfies MixerMessage)
      for (const id of gone) sent.delete(id)
    }
  }

  voices(trackId: string, voices: Voice[], smooth: boolean) {
    const sig = voices.map((v) => v.key + '#' + v.sig).join('|')
    if (this.sent.get(trackId) === sig) return
    this.sent.set(trackId, sig)
    this.nodes.get(trackId)?.port.postMessage({ type: 'voices', voices, smooth } satisfies MixerMessage)
  }

  /** 使わなくなったトラックのミキサーを外す */
  drop(trackId: string) {
    const n = this.nodes.get(trackId)
    if (!n) return
    n.port.postMessage({ type: 'stop' } satisfies MixerMessage)
    n.disconnect()
    this.nodes.delete(trackId)
    this.sent.delete(trackId)
  }

  /** 全部をフェードアウトして止める（ミキサーは止まったら処理をやめる） */
  stop() {
    for (const n of this.nodes.values()) n.port.postMessage({ type: 'stop' } satisfies MixerMessage)
  }

  disconnect() {
    for (const n of this.nodes.values()) n.disconnect()
    this.nodes.clear()
    this.sent.clear()
  }

  /** 送ったものを、すべてのミキサーが受け取るまで待つ（書き出しを始める前） */
  async flush() {
    await Promise.all(
      [...this.nodes.values()].map(
        (n) =>
          new Promise<void>((resolve) => {
            const id = ++this.pings
            const on = (e: MessageEvent<{ type: string; id: number }>) => {
              if (e.data.type !== 'pong' || e.data.id !== id) return
              n.port.removeEventListener('message', on)
              resolve()
            }
            n.port.addEventListener('message', on)
            n.port.start()
            n.port.postMessage({ type: 'ping', id } satisfies MixerMessage)
          }),
      ),
    )
  }
}

/**
 * 波形ブロックの片を声にする（時刻は AudioContext の秒。t0 は時間軸の 0 秒が AudioContext の何秒か）。
 * つなぎ目は前後に XFADE ずつ重ねる（隣の片と重なる所だけ。かたまりには余白があるので音はある）
 */
export function voicesOf(b: Block, pieces: Piece[], zero: number, level: number, env: number[]): Voice[] {
  const bt0 = zero + b.start
  const bt1 = bt0 + b.length
  const spanEnd = b.offset + b.length * b.rate
  const base = `${b.start}|${b.offset}|${b.length}|${b.rate}|${level}|${b.fadeIn}|${b.fadeOut}|${env.join(',')}`
  return pieces.map((pc, i) => {
    const joinA = i > 0 && pieces[i - 1].z >= pc.a - 1e-6
    const joinZ = i < pieces.length - 1 && pieces[i + 1].a <= pc.z + 1e-6
    const a = joinA ? pc.a - XFADE * b.rate : pc.a
    const z = joinZ ? Math.min(spanEnd, pc.z + XFADE * b.rate) : pc.z
    // 片の音は元の音の pc.from 秒からで、速度の分だけ伸び縮みしている（元の音そのままなら from は 0、速度は 1）
    const t0 = bt0 + (a - b.offset) / b.rate
    const t1 = bt0 + (z - b.offset) / b.rate
    const id = clipId(pc.clip)
    return {
      key: `${b.id}:${id}:${pc.a}`,
      sig: `${base}|${id}|${a}|${z}`,
      t0,
      t1,
      clip: id,
      f0: ((a - pc.from) / b.rate) * pc.clip.sampleRate,
      bt0,
      bt1,
      fadeIn: b.fadeIn,
      fadeOut: b.fadeOut,
      joinIn: joinA ? XFADE * 2 : 0,
      joinOut: joinZ ? XFADE * 2 : 0,
      level,
      env,
    }
  })
}
