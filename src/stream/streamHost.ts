// 先を走る方式のメインスレッドの側。Worker（stream.worker.ts）と、トラックごとの読むだけのノードを組み、プロジェクトの変更を送る（memo/anticipate-stream.md）
import { externalPackage, findPlugin, migrateValues, type Clip } from 'wevocal-lib'
import { processorName } from 'wevocal-lib/stream'
import { prerollOf } from '../anticipate'
import { piecesFor } from '../dsp/pitch'
import { clipId, voicesOf } from '../mixer/mixer'
import type { Voice } from '../mixer/types'
import { volumeSteps } from '../engine/params'
import { audible, dbToGain, descendants, liveSlots, midiBlocks, type Project, type Track } from '../project'
import type { StreamSlot } from './trackStream'
import type { ReaderControl, ReaderEvent, StreamEvent, StreamMessage } from './types'
import readerUrl from './stream.reader.worklet.ts?worker&url'

/** 再生位置を Worker に知らせる間隔（ミリ秒） */
const POS_EVERY = 50
/** 再生を始めてから、足りなかった知らせを数えない間（秒） */
const GRACE = 0.3
/** これより多く足りなければ（1 回の知らせのサンプル数）、このトラックはやめてノードで鳴らす */
const GIVE_UP = 2048

const loaded = new WeakMap<BaseAudioContext, Promise<void>>()
const loadReader = (ctx: BaseAudioContext) => {
  let p = loaded.get(ctx)
  if (!p) loaded.set(ctx, (p = ctx.audioWorklet.addModule(readerUrl)))
  return p
}

/** processor の列にできる FX の項目（外から足した wevocal の processor だけ。WAM と VST は今は対象外）。できなければ null */
function streamSlots(t: Track, sampleRate: number): { slots: StreamSlot[]; sources: Map<string, string> } | null {
  const slots: StreamSlot[] = []
  const sources = new Map<string, string>()
  for (const s of liveSlots(t)) {
    const plugin = findPlugin(s.plugin)
    const pkg = externalPackage(plugin)
    if (!plugin || !pkg || pkg.manifest.format !== 'wevocal' || !pkg.processor || s.sidechain) return null
    const key = `${pkg.manifest.id}@${pkg.manifest.version}`
    sources.set(key, pkg.processor)
    slots.push({
      key,
      name: processorName(pkg.manifest.id),
      params: pkg.manifest.params,
      values: migrateValues(pkg.manifest, s.values),
      auto: s.auto,
      on: s.on,
      options: { wasm: pkg.wasm, sampleRate, state: s.state, offline: false },
    })
  }
  return { slots, sources }
}

/** 先を走る方式にできるトラックか（子のトラック、音源、MIDI ブロックがなく、FX が全部 wevocal の processor） */
export function streamable(p: Project, t: Track, sampleRate: number): boolean {
  return !descendants(p, t).length && !t.instrument && !midiBlocks(p).some((b) => b.track === t.id) && !!streamSlots(t, sampleRate)?.slots.length
}

/** トラックの声（曲の秒。起点 0）と、使う音のデータ */
function trackVoices(p: Project, t: Track, used: Map<number, Clip>): Voice[] {
  const sources = new Map(p.sources.map((s) => [s.id, s]))
  const out: Voice[] = []
  for (const b of p.blocks) {
    const source = sources.get(b.source)
    if (b.track !== t.id || b.mute || !source) continue
    const pieces = piecesFor(b, source)
    for (const pc of pieces) used.set(clipId(pc.clip), pc.clip)
    const env = volumeSteps(b.envelope ?? []).flatMap((pt) => [b.start + pt.t, dbToGain(pt.db)])
    out.push(...voicesOf(b, pieces, 0, dbToGain(b.gain), env))
  }
  return out
}

export class StreamHost {
  private readonly ctx: AudioContext
  private worker: Worker | null = null
  private readonly readers = new Map<string, AudioWorkletNode>()
  private readonly sentClips = new Set<number>()
  /** トラックごとに最後に送った値（同じなら送らない） */
  private readonly sent = new Map<string, { sig: string; states: string }>()
  private posTimer: ReturnType<typeof setInterval> | null = null
  private zero = 0
  /** 鳴らし始めた時刻（begin の前は Infinity。足りなかった知らせを数えない） */
  private startedAt = Infinity
  /** 再生を始めてから、最初の分が届いたトラック */
  private readyIds = new Set<string>()
  private onReady: (() => void) | null = null
  /** このトラックをやめて、ノードで鳴らす側に戻してほしい（作れなかった、間に合わなかった） */
  onGiveUp: ((id: string) => void) | null = null
  /** プラグインが状態を保存したいとき（トラックの id、FX の項目の番号、base64） */
  onState: ((id: string, index: number, state: string) => void) | null = null

  constructor(ctx: AudioContext) {
    this.ctx = ctx
  }

  private post(m: StreamMessage, transfer: Transferable[] = []) {
    this.worker?.postMessage(m, transfer)
  }

  private ensureWorker() {
    if (this.worker) return
    this.worker = new Worker(new URL('./stream.worker.ts', import.meta.url), { type: 'module' })
    this.worker.onmessage = (e: MessageEvent<StreamEvent>) => {
      if (e.data.type === 'ready') {
        this.readyIds.add(e.data.id)
        this.onReady?.()
      } else if (e.data.type === 'state') this.onState?.(e.data.id, e.data.index, e.data.state)
      else if (e.data.type === 'failed') {
        console.warn('anticipate (stream):', e.data.error)
        this.onGiveUp?.(e.data.id)
      }
    }
    this.post({ type: 'init', sampleRate: this.ctx.sampleRate })
  }

  /**
   * 曲の from 秒から作り始め（その前に余韻の長さだけ流す）、最初の分ができるまで（長くても wait ミリ秒）待つ。鳴らし始める時刻は begin で渡す。
   * ids は先を走る方式で鳴らしたいトラック。間に合わなかったトラックは外す（今回はノードで鳴らす）
   */
  async prepare(p: Project, ids: string[], from: number, wait: number) {
    await loadReader(this.ctx)
    this.ensureWorker()
    for (const id of ids) this.syncTrack(p, id, false)
    this.readyIds.clear()
    const done = new Promise<void>((resolve) => {
      this.onReady = () => this.ids.every((id) => this.readyIds.has(id)) && resolve()
      setTimeout(resolve, wait)
    })
    this.post({ type: 'play', frame: Math.round(from * this.ctx.sampleRate) })
    await done
    this.onReady = null
    for (const id of this.ids) if (!this.readyIds.has(id)) this.remove(id)
  }

  /** 鳴らし始める（zero は曲の 0 秒にあたる ctx の時刻）。読むだけのノードを、トラックの先に作った音の入口（cache）につなぐ */
  begin(zero: number, dest: (id: string) => AudioNode | null) {
    this.zero = zero
    this.startedAt = this.ctx.currentTime
    for (const [id, node] of this.readers) {
      const d = dest(id)
      if (d) node.connect(d)
      node.port.postMessage({ type: 'zero', zero } satisfies ReaderControl)
    }
    const send = () => this.post({ type: 'pos', frame: Math.round((this.ctx.currentTime - this.zero) * this.ctx.sampleRate) })
    send()
    this.posTimer = setInterval(send, POS_EVERY)
  }

  /** 再生中に変えたもの（音量、FX の値、波形ブロック）を送る。作ってある先は捨てて作り直す */
  update(p: Project) {
    for (const id of this.readers.keys()) this.syncTrack(p, id, true)
  }

  /** このトラックをやめる（ノードで鳴らす側に戻す） */
  remove(id: string) {
    const node = this.readers.get(id)
    node?.port.postMessage({ type: 'stop' } satisfies ReaderControl)
    node?.disconnect()
    this.readers.delete(id)
    this.sent.delete(id)
    this.post({ type: 'remove', id })
  }

  /** 止める。Worker と processor は残す（次の再生で使い回す） */
  stop() {
    if (this.posTimer) clearInterval(this.posTimer)
    this.posTimer = null
    this.startedAt = Infinity
    this.post({ type: 'stop' })
    for (const id of [...this.readers.keys()]) this.remove(id)
  }

  get ids() {
    return [...this.readers.keys()]
  }

  private syncTrack(p: Project, id: string, smooth: boolean) {
    const t = p.tracks.find((x) => x.id === id)
    const made = t && streamSlots(t, this.ctx.sampleRate)
    if (!t || !made) return this.onGiveUp?.(id)
    for (const [key, source] of made.sources) this.post({ type: 'source', key, source })
    const used = new Map<number, Clip>()
    const voices = trackVoices(p, t, used)
    for (const [cid, c] of used)
      if (!this.sentClips.has(cid)) {
        this.post({ type: 'clip', id: cid, sampleRate: c.sampleRate, channels: c.channels })
        this.sentClips.add(cid)
      }
    const gain = audible(p, t) ? dbToGain(t.volume) * (t.invert ? -1 : 1) : 0
    // プラグインの状態は別に比べる（プラグインが知らせた状態が戻ってきただけで、作ってある先を捨てないように）
    const sig = JSON.stringify([gain, made.slots.map(({ options: _o, ...s }) => s), voices.map((v) => v.key + v.sig)])
    const states = JSON.stringify(made.slots.map((s) => s.options.state ?? null))
    let port: MessagePort | undefined
    if (!this.readers.has(id)) {
      const node = new AudioWorkletNode(this.ctx, 'stream-reader', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] })
      const channel = new MessageChannel()
      node.port.postMessage({ type: 'connect', port: channel.port1, zero: this.zero } satisfies ReaderControl, [channel.port1])
      node.port.onmessage = (e: MessageEvent<ReaderEvent>) => {
        // 始めたばかりの足りなさは数えない。続けて大きく足りなければ、ノードで鳴らす側に戻す
        if (this.ctx.currentTime - this.startedAt > GRACE && e.data.frames > GIVE_UP) this.onGiveUp?.(id)
      }
      this.readers.set(id, node)
      port = channel.port2
    }
    const last = this.sent.get(id)
    if (!port && last?.sig === sig && last.states === states) return
    this.sent.set(id, { sig, states })
    this.post({ type: 'track', id, gain, slots: made.slots, voices, smooth, rewind: smooth && last?.sig !== sig, preroll: prerollOf(p, t), port }, port ? [port] : [])
  }
}
