// 先を走る方式のメインスレッドの側。Worker（stream.worker.ts）と、トラックごとの読むだけのノードを組み、プロジェクトの変更を送る（memo/anticipate-stream.md）
import { externalPackage, findPlugin, migrateValues, readySnapshot, type Clip } from 'wevocal-lib'
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
/** 足りない知らせ（約 0.25 秒ごと）がこの回数続いたら、このトラックはやめてノードで鳴らす（約 3 秒。少し足りないだけでは戻さない） */
const GIVE_UP = 12
/** 鳴らし始めてから、最初の分がこれより長く届かなければ（秒）、このトラックはやめてノードで鳴らす（助走が終わらないほど重いとき） */
const FIRST_LIMIT = 5

/** Worker の数（トラックを割り振る。1 つだと CPU のコアを 1 つしか使えず、重いトラックが 2 本あると足りなくなる） */
const WORKERS = Math.max(1, Math.min(2, (typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 2) - 2))

const loaded = new WeakMap<BaseAudioContext, Promise<void>>()
const loadReader = (ctx: BaseAudioContext) => {
  let p = loaded.get(ctx)
  if (!p) loaded.set(ctx, (p = ctx.audioWorklet.addModule(readerUrl)))
  return p
}

/** processor の列にできる FX の項目（外から足した wevocal の processor と VST。WAM は Worker で動かせないので対象外）。できなければ null */
function streamSlots(t: Track, sampleRate: number): { slots: StreamSlot[]; sources: Map<string, { source: string; assets: Record<string, unknown> }> } | null {
  const slots: StreamSlot[] = []
  const sources = new Map<string, { source: string; assets: Record<string, unknown> }>()
  for (const s of liveSlots(t)) {
    const plugin = findPlugin(s.plugin)
    const pkg = externalPackage(plugin)
    const format = pkg?.manifest.format
    if (!plugin || !pkg || (format !== 'wevocal' && format !== 'vst') || !pkg.processor || s.sidechain) return null
    const key = `${pkg.manifest.id}@${pkg.manifest.version}`
    // 大きいもの（wasm、dll、写し）はプラグインごとに 1 回だけ送る。項目には小さい値だけを持たせる
    sources.set(key, { source: pkg.processor, assets: { wasm: pkg.wasm, dll: pkg.dll, snap: format === 'vst' ? readySnapshot(pkg) : null } })
    slots.push({
      key,
      name: processorName(pkg.manifest.id),
      params: pkg.manifest.params,
      values: migrateValues(pkg.manifest, s.values),
      auto: s.auto,
      on: s.on,
      // offline: VST は途中を素通しにせず、最初に読み込みを済ませる（Worker なので画面は止まらない）
      options: { sampleRate, state: s.state, offline: true },
    })
  }
  return { slots, sources }
}

/** 先を走る方式にできるトラックか（子のトラック、音源、MIDI ブロックがなく、FX が全部 wevocal の processor か VST） */
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
  /** Worker ごとの、送ったプラグインのソースと元の音（Worker が残っている間は送り直さない） */
  private readonly workers: { worker: Worker; sources: Set<string>; clips: Set<number>; tracks: number }[] = []
  /** トラックを受け持つ Worker の番号 */
  private readonly owner = new Map<string, number>()
  private readonly readers = new Map<string, AudioWorkletNode>()
  /** トラックごとに最後に送った値（同じなら送らない） */
  private readonly sent = new Map<string, { sig: string; states: string }>()
  private posTimer: ReturnType<typeof setInterval> | null = null
  /** begin ごとの番号（止めたあとに、前の再生の見張りが動かないように） */
  private session = 0
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

  /** 全部の Worker に送る（再生、位置、止める） */
  private post(m: StreamMessage) {
    for (const w of this.workers) w.worker.postMessage(m)
  }

  private ensureWorker() {
    if (this.workers.length) return
    for (let k = 0; k < WORKERS; k++) {
      const worker = new Worker(new URL('./stream.worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = (e: MessageEvent<StreamEvent>) => {
        if (e.data.type === 'ready') {
          this.readyIds.add(e.data.id)
          this.onReady?.()
        } else if (e.data.type === 'state') this.onState?.(e.data.id, e.data.index, e.data.state)
        else if (e.data.type === 'failed') {
          console.warn('anticipate (stream):', e.data.error)
          this.onGiveUp?.(e.data.id)
        }
      }
      worker.postMessage({ type: 'init', sampleRate: this.ctx.sampleRate } satisfies StreamMessage)
      this.workers.push({ worker, sources: new Set(), clips: new Set(), tracks: 0 })
    }
  }

  /** トラックを受け持つ Worker（初めてなら、受け持ちの少ないものに割り振る） */
  private workerOf(id: string) {
    let k = this.owner.get(id)
    if (k === undefined) {
      k = this.workers.reduce((best, w, i) => (w.tracks < this.workers[best].tracks ? i : best), 0)
      this.owner.set(id, k)
      this.workers[k].tracks++
    }
    return this.workers[k]
  }

  /**
   * 曲の from 秒から作り始め（その前に余韻の長さだけ流す）、最初の分ができるまで（長くても wait ミリ秒）待つ。鳴らし始める時刻は begin で渡す。
   * ids は先を走る方式で鳴らしたいトラック。間に合わなかったトラックも外さず、届くまで無音で待つ（ノードに戻すと、重い VST が読み込みの間素通しになるため）
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
    const session = ++this.session
    setTimeout(() => {
      if (session !== this.session) return
      for (const id of this.ids) if (!this.readyIds.has(id)) this.onGiveUp?.(id)
    }, FIRST_LIMIT * 1000)
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
    const k = this.owner.get(id)
    if (k !== undefined) {
      this.workers[k].worker.postMessage({ type: 'remove', id } satisfies StreamMessage)
      this.workers[k].tracks--
      this.owner.delete(id)
    }
  }

  /** 止める。Worker と processor は残す（次の再生で使い回す） */
  stop() {
    this.session++
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
    const w = this.workerOf(id)
    for (const [key, { source, assets }] of made.sources)
      if (!w.sources.has(key)) {
        w.worker.postMessage({ type: 'source', key, source, assets } satisfies StreamMessage)
        w.sources.add(key)
      }
    const used = new Map<number, Clip>()
    const voices = trackVoices(p, t, used)
    for (const [cid, c] of used)
      if (!w.clips.has(cid)) {
        w.worker.postMessage({ type: 'clip', id: cid, sampleRate: c.sampleRate, channels: c.channels } satisfies StreamMessage)
        w.clips.add(cid)
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
      let lacking = 0
      node.port.onmessage = (_e: MessageEvent<ReaderEvent>) => {
        // 始めたばかりの足りなさは数えない。足りない知らせが続いたときだけ、ノードで鳴らす側に戻す（間が空けば数え直す）
        if (this.ctx.currentTime - this.startedAt <= GRACE) return
        const at = this.ctx.currentTime
        lacking = at - lastLack < 0.6 ? lacking + 1 : 1
        lastLack = at
        if (lacking >= GIVE_UP) this.onGiveUp?.(id)
      }
      let lastLack = -Infinity
      this.readers.set(id, node)
      port = channel.port2
    }
    const last = this.sent.get(id)
    if (!port && last?.sig === sig && last.states === states) return
    this.sent.set(id, { sig, states })
    w.worker.postMessage({ type: 'track', id, gain, slots: made.slots, voices, smooth, rewind: smooth && last?.sig !== sig, preroll: prerollOf(p, t), port } satisfies StreamMessage, port ? [port] : [])
  }
}
