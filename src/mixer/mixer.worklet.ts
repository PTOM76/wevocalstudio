// 波形ブロックの音を足すミキサー（AudioWorklet。音を出すスレッドで 128 サンプルずつ、今かかっている声だけを読んで足す）
import type { MixerMessage, Voice } from './types'

// AudioWorkletGlobalScope の型（TypeScript の標準の型にはない）
declare const sampleRate: number
declare const currentTime: number
declare class AudioWorkletProcessor {
  readonly port: MessagePort
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void

/** 音のデータの置き場（同じ AudioContext のミキサーで共通。id で 1 回だけ送られてくる） */
const clips = new Map<number, { sampleRate: number; channels: Float32Array[] }>()

/** 消えた声、止めたときに 0 まで下げる長さ（秒） */
const FADE = 0.02

/** 鳴らしている声と、足されたとき（途中から足されたらフェードイン）、消されたとき（フェードアウト） */
interface Live {
  v: Voice
  bornAt: number
  diedAt: number
}

/** 時刻 t の声の音量（線形） */
function gainAt(l: Live, t: number): number {
  const v = l.v
  let g = v.level
  // 波形ブロックのフェード
  if (v.fadeIn > 0 && t < v.bt0 + v.fadeIn) g *= Math.max(0, (t - v.bt0) / v.fadeIn)
  if (v.fadeOut > 0 && t > v.bt1 - v.fadeOut) g *= Math.max(0, (v.bt1 - t) / v.fadeOut)
  // 片のつなぎ目（隣の片と XFADE ずつ重ねる）
  if (v.joinIn > 0 && t < v.t0 + v.joinIn) g *= Math.max(0, (t - v.t0) / v.joinIn)
  if (v.joinOut > 0 && t > v.t1 - v.joinOut) g *= Math.max(0, (v.t1 - t) / v.joinOut)
  // 音量のエンベロープ（点の間は線形。外は端の点の値）
  const e = v.env
  if (e.length) {
    if (t <= e[0]) g *= e[1]
    else if (t >= e[e.length - 2]) g *= e[e.length - 1]
    else
      for (let i = 2; i < e.length; i += 2)
        if (t <= e[i]) {
          const t0 = e[i - 2]
          g *= t0 === e[i] ? e[i + 1] : e[i - 1] + ((e[i + 1] - e[i - 1]) * (t - t0)) / (e[i] - t0)
          break
        }
  }
  // 途中から足された、消された
  if (l.bornAt > 0) g *= Math.min(1, Math.max(0, (t - l.bornAt) / FADE))
  if (l.diedAt > 0) g *= Math.max(0, 1 - (t - l.diedAt) / FADE)
  return g
}

class BlockMixer extends AudioWorkletProcessor {
  /** 声（始まりの順） */
  private live: Live[] = []
  /** 止めたとき（全部をフェードアウトして、終わったら処理をやめる） */
  private stoppedAt = 0

  constructor() {
    super()
    this.port.onmessage = (e: MessageEvent<MixerMessage>) => this.receive(e.data)
  }

  private receive(m: MixerMessage) {
    if (m.type === 'clip') clips.set(m.id, { sampleRate: m.sampleRate, channels: m.channels })
    else if (m.type === 'unclip') for (const id of m.ids) clips.delete(id)
    else if (m.type === 'voices') {
      const now = currentTime
      const keep = new Map(this.live.filter((l) => l.diedAt === 0).map((l) => [l.v.key, l]))
      const next: Live[] = []
      for (const v of m.voices) {
        const old = keep.get(v.key)
        keep.delete(v.key)
        // 変わっていない声はそのまま。新しい声は、途中から始まるなら（差し替え）フェードインする
        next.push(old && old.v.sig === v.sig ? old : { v, bornAt: m.smooth && v.t0 < now ? now : 0, diedAt: 0 })
        if (old && old.v.sig !== v.sig) this.live.push({ ...old, diedAt: now })
      }
      // 消えた声と、消している途中の声はフェードアウトしてから捨てる
      for (const l of keep.values()) next.push({ ...l, diedAt: now })
      for (const l of this.live) if (l.diedAt > 0 && now < l.diedAt + FADE) next.push(l)
      next.sort((a, b) => a.v.t0 - b.v.t0)
      this.live = next
    } else if (m.type === 'stop') this.stoppedAt = currentTime
    else if (m.type === 'ping') this.port.postMessage({ type: 'pong', id: m.id })
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]) {
    const out = outputs[0]
    const L = out[0]
    const R = out[1] ?? out[0]
    const n = L.length
    const t0 = currentTime
    const t1 = t0 + n / sampleRate
    if (this.stoppedAt > 0 && t0 > this.stoppedAt + FADE) return false
    const stopping = this.stoppedAt > 0
    // 終わった声をその場で詰めて捨てる（process の中では配列を作らない）
    const live = this.live
    let w = 0
    for (let r = 0; r < live.length; r++) {
      const l = live[r]
      if (l.v.t1 <= t0 || (l.diedAt > 0 && t0 > l.diedAt + FADE)) continue
      live[w++] = l
    }
    live.length = w
    for (const l of live) {
      const v = l.v
      if (v.t0 >= t1) break
      const clip = clips.get(v.clip)
      if (!clip) continue
      // 音量は 128 サンプルの頭と終わりで求めて、その間は直線で結ぶ（フェードは 5 ms 以上なので十分）
      let ga = gainAt(l, t0)
      let gb = gainAt(l, t1)
      if (stopping) {
        ga *= Math.max(0, 1 - (t0 - this.stoppedAt) / FADE)
        gb *= Math.max(0, 1 - (t1 - this.stoppedAt) / FADE)
      }
      if (ga === 0 && gb === 0) continue
      const cl = clip.channels[0]
      const cr = clip.channels[1] ?? cl
      const len = cl.length
      // 元の音の位置（ctx と元の音のサンプルレートが違えば、その比で進める）
      const step = clip.sampleRate / sampleRate
      const startPos = v.f0 + (t0 - v.t0) * clip.sampleRate
      // 128 サンプルのうち声にかかる所だけを回す
      const i0 = Math.max(0, Math.ceil((v.t0 - t0) * sampleRate))
      const i1 = Math.min(n, Math.ceil((v.t1 - t0) * sampleRate))
      for (let i = i0; i < i1; i++) {
        const pos = startPos + i * step
        const k = Math.floor(pos)
        if (k < 0 || k + 1 >= len) continue
        const f = pos - k
        const g = ga + ((gb - ga) * i) / n
        L[i] += (cl[k] + (cl[k + 1] - cl[k]) * f) * g
        R[i] += (cr[k] + (cr[k + 1] - cr[k]) * f) * g
      }
    }
    return true
  }
}

registerProcessor('block-mixer', BlockMixer)
