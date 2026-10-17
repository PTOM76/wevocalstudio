// 再生と書き出し。波形ブロックの音は、トラックごとのミキサー（AudioWorklet）が 128 サンプルずつ今かかっている所だけを読んで足す。
// トラックの FX の列、パン、メーターとマスターは Web Audio のノード。再生中に変えたときは、声の一覧を送り直し、トラックとマスターは値だけを変える
import { AHEAD, anticipated, CHUNK, PREROLL, signature } from './anticipate'
import { createInstrument, findInstrument, preloadInstruments, type InstrumentInstance, type NoteEvent } from 'wevocal-lib'
import { automatedSlots, chainLatency, createFxChain, hasAutomation, type ChainOptions, limitedOutput, preloadFx, startContext, startRenderLoad, type Clip, type FxChain } from 'wevocal-lib'
import { clipId, loadMixer, Mixers, voicesOf } from './mixer/mixer'
import type { Voice } from './mixer/types'
import { piecesFor, preparePitch } from './dsp/pitch'
import { ancestors, audible, flowsTo, SEND_MIN, dbToGain, songEnd, type Project, type Track } from './project'

/** 鳴らし直すとき、差し替えるときのつなぎ（秒） */
const FADE = 0.02
interface TrackNodes {
  input: GainNode
  /** 波形ブロックの音の入口。FX の遅れ（latency）をそろえるため、遅れの少ないトラックを遅らせる（子のトラックの音は入らない） */
  comp: DelayNode
  /** 先に作った音の入口（FX の列の出口へ足す。ミュートとソロはここで切る） */
  cache: GainNode
  /** サイドチェーンの取り出し口（パンのあとの音。ほかのトラックの FX がこれを聞く） */
  tap: GainNode
  /** センド（送り先のトラックの id → 送る量のゲイン） */
  sends: Map<string, GainNode>
  pan: StereoPannerNode
  /** レベルメーターの入口（パンのあと）と、左右の AnalyserNode（WeVocalSynth と同じく左右を別に測る） */
  split: ChannelSplitterNode
  meter: [AnalyserNode, AnalyserNode]
  /** 出し先（親のトラックの id か 'master'。変わったときだけつなぎ直す） */
  dest: string
  /** FX の列（WeVocal プラグイン。鳴らしたまま値を変える。wevocal-lib） */
  fx: FxChain
  /** 音源（MIDI ブロックの音符を鳴らす）。キーは作り直すかの判断（プラグインと音色の元の音） */
  inst: { key: string; instance: InstrumentInstance; sig: string; sentUntil: number } | null
}

/** 音源のプラグインの準備に使う、プロジェクトの音源の id */
const instrumentIds = (p: Project) => p.tracks.flatMap((t) => (t.instrument ? [t.instrument.plugin] : []))

/** トラックの MIDI ブロックの識別（変わったら、送った音符を取り消して送り直す） */
const midiSig = (p: Project, track: string) => JSON.stringify((p.midi ?? []).filter((b) => b.track === track))
/** 組んだノード（トラックごとの入口とミキサー、マスター） */
class Graph {
  readonly out: GainNode
  /** マスターの左右のレベルメーター */
  readonly masterMeters: [AnalyserNode, AnalyserNode]
  private readonly master: GainNode
  private readonly masterPan: StereoPannerNode
  /** マスターの FX の列 */
  private readonly masterFx: FxChain
  /** プロジェクトのテンポ（ディレイの同期に使う） */
  private bpm = 120
  private readonly tracks = new Map<string, TrackNodes>()
  /** トラックごとのミキサー（波形ブロックの音を足す） */
  private readonly mixers: Mixers
  private readonly ctx: BaseAudioContext
  /** 時間軸の 0 秒が ctx の何秒か */
  private readonly zero: number
  /** 先に作った音で鳴らすトラック（波形ブロックと FX の列は動かさない） */
  private anticipated = new Set<string>()
  /** 先に作った音の再生（トラックごと。止めるときに使う） */
  private cacheSources = new Map<string, AudioBufferSourceNode[]>()
  /** 最後に同期したプロジェクト（サイドチェーンの輪を作らないかの確認に使う） */
  private proj: Project | null = null
  /** 最初の同期を済ませたか（マスターの値を、最初だけならさずに入れる） */
  private synced = false
  /** プラグインが状態を保存したいとき（どのトラックか 'master'、何番目の項目か、base64）。再生のときだけ */
  onFxState: ((target: string, index: number, state: string) => void) | null = null

  constructor(ctx: BaseAudioContext, zero: number) {
    this.ctx = ctx
    this.zero = zero
    this.mixers = new Mixers(ctx)
    this.master = ctx.createGain()
    this.masterPan = ctx.createStereoPanner()
    this.out = ctx.createGain()
    this.masterFx = createFxChain(ctx, [], this.host, this.chainOptions('master'))
    // 再生は耳とスピーカーを守るリミッターを通す（wevocal-lib。WeVocalSynth と同じ）。書き出しは通さない
    this.master.connect(this.masterFx.input)
    this.masterFx.output.connect(this.masterPan).connect(this.out).connect(ctx instanceof AudioContext ? limitedOutput(ctx) : ctx.destination)
    // 左右に分けて別々に測る（AnalyserNode はチャンネルを混ぜて読むため。WeVocalSynth と同じ）
    const split = ctx.createChannelSplitter(2)
    this.out.connect(split)
    const l = Graph.analyser(ctx)
    const r = Graph.analyser(ctx)
    split.connect(l, 0)
    split.connect(r, 1)
    this.masterMeters = [l, r]
  }

  /** FX の列とのやり取り: 状態の保存と、サイドチェーンの音の取り出し（輪になるものは断る） */
  private chainOptions(target: string): ChainOptions {
    return {
      onState: (i, st) => this.onFxState?.(target, i, st),
      sidechain: (source) => (this.canTap(target, source) ? (this.tracks.get(source)?.tap ?? null) : null),
    }
  }

  /** target の FX が source の音を聞いてよいか。音の流れ（子から親へ、サイドチェーンから聞く先へ、センド）が輪にならなければよい */
  private canTap(target: string, source: string): boolean {
    return !!this.proj && target !== source && !flowsTo(this.proj, target, source)
  }

  /** そのトラックで、今ノードとして動かす FX の列（先に作った音で鳴らすトラックは空） */
  private liveFx(t: Track) {
    return this.anticipated.has(t.id) ? [] : (t.fx ?? [])
  }

  /** 先に作った音で鳴らすトラックを決める（sync の前に呼ぶ） */
  setAnticipated(ids: Iterable<string>) {
    this.anticipated = new Set(ids)
  }

  /** 先に作った音を、曲の時刻 start から鳴らす。すでに過ぎた分は、途中から */
  playChunk(trackId: string, buffer: AudioBuffer, start: number) {
    const n = this.tracks.get(trackId)
    if (!n) return
    const src = this.ctx.createBufferSource()
    src.buffer = buffer
    src.connect(n.cache)
    const when = this.zero + start
    const now = this.ctx.currentTime
    if (when >= now) src.start(when)
    else if (now - when < buffer.duration) src.start(now, now - when)
    const list = this.cacheSources.get(trackId) ?? []
    list.push(src)
    this.cacheSources.set(trackId, list)
    src.onended = () => this.cacheSources.set(trackId, (this.cacheSources.get(trackId) ?? []).filter((x) => x !== src))
  }

  /** 先に作った音をやめ、ノードの FX の列と波形ブロックの声で鳴らす（編集したときと、先読みが間に合わなかったとき） */
  release(trackId: string) {
    for (const s of this.cacheSources.get(trackId) ?? []) {
      try {
        s.stop()
      } catch {
        // まだ始まっていないものは止められる。終わったものは無視
      }
      s.disconnect()
    }
    this.cacheSources.delete(trackId)
    this.anticipated.delete(trackId)
  }

  /** そのトラックの音符を、AudioContext の時刻にして並べる（曲の時刻が [from, to) に始まるもの） */
  private noteEvents(p: Project, track: string, from: number, to: number): NoteEvent[] {
    const out: NoteEvent[] = []
    for (const b of p.midi ?? []) {
      if (b.track !== track || b.mute) continue
      for (const n of b.notes) {
        const t = b.start + n.t
        // ブロックの外にはみ出した音符は、ブロックの終わりで切る
        const dur = Math.min(n.dur, b.length - n.t)
        if (t >= from && t < to && dur > 0) out.push({ time: this.zero + t, dur, pitch: n.pitch, vel: n.vel })
      }
    }
    return out.sort((a, b) => a.time - b.time)
  }

  /** 音源の組み立て: トラックに音源があれば作り、変わっていれば作り直し、なければ外す。書き出しは音符を全部、作るときに渡す */
  private syncInstrument(p: Project, t: Track, n: TrackNodes) {
    const spec = t.instrument
    const plugin = spec && !this.anticipated.has(t.id) ? findInstrument(spec.plugin) : undefined
    const key = plugin ? `${spec!.plugin}|${spec!.sample ?? ''}` : ''
    if (n.inst && n.inst.key !== key) {
      n.inst.instance.dispose()
      n.inst = null
    }
    if (!plugin || !spec) return
    const live = this.ctx instanceof AudioContext
    if (!n.inst) {
      const src = spec.sample ? p.sources.find((s) => s.id === spec.sample) : undefined
      const sample = src ? { channels: src.clip.channels, sampleRate: src.clip.sampleRate } : null
      const instance = createInstrument(this.ctx, plugin, spec.values, { events: live ? [] : this.noteEvents(p, t.id, -Infinity, Infinity), sample })
      instance.output.connect(n.comp)
      n.inst = { key, instance, sig: midiSig(p, t.id), sentUntil: this.timeNow() }
    }
    n.inst.instance.update(spec.values)
    const sig = midiSig(p, t.id)
    if (live && sig !== n.inst.sig) {
      // 音符が変わったら、送った音符を取り消して、今から送り直す
      n.inst.instance.clear()
      n.inst.sig = sig
      n.inst.sentUntil = this.timeNow()
    }
  }

  /** 再生中、これから 0.5 秒ぶんの音符を音源へ送る（時刻つきなので、遅れずに正確に鳴る）。一定の間隔で呼ぶ */
  pumpMidi() {
    const p = this.proj
    if (!p || !(this.ctx instanceof AudioContext)) return
    const to = this.timeNow() + 0.5
    for (const t of p.tracks) {
      const n = this.tracks.get(t.id)
      if (!n?.inst) continue
      n.inst.instance.schedule(this.noteEvents(p, t.id, n.inst.sentUntil, to))
      n.inst.sentUntil = to
    }
  }

  /** 音源に今すぐ音を鳴らす、離す（キーボードのモニター）。音源のないトラックなら何もしない */
  noteOn(track: string, pitch: number, vel: number) {
    this.tracks.get(track)?.inst?.instance.noteOn(pitch, vel)
  }
  noteOff(track: string, pitch: number) {
    this.tracks.get(track)?.inst?.instance.noteOff(pitch)
  }

  /** 曲の中の今の時刻（秒）。再生中は ctx の時計から求める */
  private timeNow() {
    return Math.max(0, this.ctx.currentTime - this.zero)
  }

  /** オートメーションがあるか */
  get automated(): boolean {
    const p = this.proj
    return !!p && (hasAutomation(p.master.fx) || p.tracks.some((t) => hasAutomation(t.fx)))
  }

  /** オートメーションのあるエフェクトのつまみを、時刻 t（省くと今）の値にする。再生中は一定の間隔で呼ぶ */
  automate(t = this.timeNow()) {
    const p = this.proj
    if (!p) return
    if (hasAutomation(p.master.fx)) this.masterFx.update(automatedSlots(p.master.fx ?? [], t))
    for (const tr of p.tracks) if (hasAutomation(tr.fx) && !this.anticipated.has(tr.id)) this.tracks.get(tr.id)?.fx.update(automatedSlots(tr.fx ?? [], t))
  }

  /** プラグインに渡すホストの情報 */
  private readonly host = { bpm: () => this.bpm }

  /** レベルメーター用の AnalyserNode（時間波形を読むだけなので小さくてよい） */
  private static analyser(ctx: BaseAudioContext) {
    const a = ctx.createAnalyser()
    a.fftSize = 1024
    return a
  }

  /** トラックのレベルメーター */
  meter(trackId: string) {
    return this.tracks.get(trackId)?.meter ?? null
  }

  private buildTrack(t: Track): TrackNodes {
    const input = this.ctx.createGain()
    const comp = this.ctx.createDelay(1)
    const tap = this.ctx.createGain()
    comp.connect(input)
    const pan = this.ctx.createStereoPanner()
    // トラック: 音量 → FX の列 → パン → マスター
    const fx = createFxChain(this.ctx, this.liveFx(t), this.host, this.chainOptions(t.id))
    input.connect(fx.input)
    fx.output.connect(pan)
    const cache = this.ctx.createGain()
    cache.connect(fx.output)
    const split = this.ctx.createChannelSplitter(2)
    const meter: [AnalyserNode, AnalyserNode] = [Graph.analyser(this.ctx), Graph.analyser(this.ctx)]
    pan.connect(split)
    pan.connect(tap)
    split.connect(meter[0], 0)
    split.connect(meter[1], 1)
    // 出し先（マスターか親のトラック）は sync でつなぐ
    return { input, comp, cache, tap, sends: new Map(), inst: null, pan, fx, split, meter, dest: '' }
  }

  /** 波形ブロックの声の一覧をミキサーに送る。変わっていない声はそのまま鳴り続け、差し替えた声は FADE でつなぐ（smooth のとき） */
  sync(p: Project, smooth: boolean) {
    // マスターとトラックの値（鳴らしたまま変える）
    const at = this.ctx.currentTime
    this.bpm = p.tempo.bpm
    this.proj = p
    // オートメーションのあるつまみは、今の時刻の値にする（再生中は automate が動かし続ける）
    const now = this.timeNow()
    this.masterFx.update(automatedSlots(p.master.fx ?? [], now))
    // 作った直後の値は、ならさずにそのまま入れる（ならすと、ミュートや音量 0 のトラックの音が、最初の数十ミリ秒だけ漏れる）
    const first = !this.synced
    this.synced = true
    const to = (param: AudioParam, v: number, now: boolean) => (now ? (param.value = v) : param.setTargetAtTime(v, at, 0.01))
    to(this.master.gain, p.master.mute ? 0 : dbToGain(p.master.volume), first)
    to(this.masterPan.pan, p.master.pan, first)
    for (const t of p.tracks) {
      let n = this.tracks.get(t.id)
      const fresh = !n
      if (!n) {
        n = this.buildTrack(t)
        this.tracks.set(t.id, n)
      } else n.fx.update(automatedSlots(this.liveFx(t), now))
      to(n.cache.gain, audible(p, t) ? 1 : 0, fresh)
      // ミュートとソロは音量 0 にする（ノードは残す）
      to(n.input.gain, audible(p, t) ? dbToGain(t.volume) * (t.invert ? -1 : 1) : 0, fresh)
      to(n.pan.pan, t.pan, fresh)
    }
    for (const t of p.tracks) this.syncInstrument(p, t, this.tracks.get(t.id)!)
    // センド: フェーダーのあとの音を、送り先のトラックの入口（FX の前）へ。輪になるものと、なくなった送り先は外す
    for (const t of p.tracks) {
      const n = this.tracks.get(t.id)!
      const want = new Map((t.sends ?? []).filter((s) => s.db > SEND_MIN && this.tracks.has(s.to) && !flowsTo(p, s.to, t.id)).map((s) => [s.to, s.db]))
      for (const [to, g] of n.sends) {
        if (want.has(to)) continue
        g.disconnect()
        n.sends.delete(to)
      }
      for (const [to, db] of want) {
        let g = n.sends.get(to)
        if (!g) {
          g = this.ctx.createGain()
          n.tap.connect(g).connect(this.tracks.get(to)!.input)
          n.sends.set(to, g)
          g.gain.value = dbToGain(db)
        }
        g.gain.setTargetAtTime(dbToGain(db), at, 0.01)
      }
    }
    // 出し先をつなぐ。サブトラックは親のトラックの入口へ、ほかはマスターへ
    for (const t of p.tracks) {
      const n = this.tracks.get(t.id)!
      const parent = t.parent ? this.tracks.get(t.parent) : undefined
      const dest = parent ? t.parent! : 'master'
      if (n.dest === dest) continue
      if (n.dest) {
        n.pan.disconnect()
        n.pan.connect(n.split)
        n.pan.connect(n.tap)
      }
      n.pan.connect(parent ? parent.input : this.master)
      n.dest = dest
    }
    for (const [id, n] of this.tracks) {
      if (p.tracks.some((t) => t.id === id)) continue
      this.mixers.drop(id)
      n.comp.disconnect()
      n.cache.disconnect()
      for (const g of n.sends.values()) g.disconnect()
      n.tap.disconnect()
      n.input.disconnect()
      n.pan.disconnect()
      this.tracks.delete(id)
    }

    // 波形ブロックの片を、トラックごとの声にする（作ったかたまりの片。変えていなければ元の音。できていない所は鳴らさない）
    const voices = new Map<string, Voice[]>(p.tracks.map((t) => [t.id, []]))
    const used = new Map<number, Clip>()
    const frozen = new Set<string>()
    for (const t of p.tracks) {
      const src = t.frozen && p.sources.find((s) => s.id === t.frozen!.source)
      if (!t.frozen || !src) continue
      // フリーズしたトラックは、書き出した音を 1 つの声として鳴らす（波形ブロックは鳴らさない）
      frozen.add(t.id)
      const id = clipId(src.clip)
      used.set(id, src.clip)
      const t0 = this.zero + t.frozen.start
      const t1 = t0 + src.duration
      voices.get(t.id)!.push({ key: `freeze:${t.id}:${id}`, sig: `${t0}`, t0, t1, clip: id, f0: 0, bt0: t0, bt1: t1, fadeIn: 0, fadeOut: 0, joinIn: 0, joinOut: 0, level: 1, env: [] })
    }
    for (const b of p.blocks) {
      const source = p.sources.find((s) => s.id === b.source)
      const list = voices.get(b.track)
      if (b.mute || !source || !list || frozen.has(b.track) || this.anticipated.has(b.track)) continue
      const pieces = piecesFor(b, source)
      if (!pieces.length) continue
      for (const pc of pieces) used.set(clipId(pc.clip), pc.clip)
      const t0 = this.zero + b.start
      const env = (b.envelope ?? []).flatMap((pt) => [t0 + pt.t, dbToGain(pt.db)])
      list.push(...voicesOf(b, pieces, this.zero, dbToGain(b.gain), env))
    }
    // FX の遅れ（秒）が違うトラックをそろえる: 波形ブロックから出口までの遅れが、どのトラックも同じになるように入口で遅らせる
    const late = new Map(p.tracks.map((t) => [t.id, [t, ...ancestors(p, t)].reduce((s, x) => s + chainLatency(x.fx, this.ctx.sampleRate), 0)]))
    const slowest = Math.max(0, ...late.values())
    for (const t of p.tracks) {
      const n = this.tracks.get(t.id)!
      n.comp.delayTime.setTargetAtTime(Math.min(1, slowest - late.get(t.id)!), at, 0.01)
      this.mixers.node(t.id, n.comp)
    }
    this.mixers.syncClips(used, new Set(p.sources.map((s) => clipId(s.clip))))
    for (const [id, list] of voices) this.mixers.voices(id, list, smooth)
  }

  /** ミキサーが送ったものを受け取るまで待つ（書き出しを始める前） */
  flush() {
    return this.mixers.flush()
  }

  /** 全部を消して止める。消え終わったら、トラック（FX の列、パン、メーター）とマスターのノードも外す（残すと、再生位置を変えるたびに溜まり、無音でも処理され続けて重くなる） */
  stopAll() {
    const t = this.ctx.currentTime
    this.out.gain.setTargetAtTime(0, t, FADE / 3)
    this.mixers.stop()
    setTimeout(() => this.dispose(), FADE * 4 * 1000)
  }

  /** ノードを全部外す */
  private dispose() {
    for (const id of [...this.cacheSources.keys()]) this.release(id)
    this.mixers.disconnect()
    for (const n of this.tracks.values()) {
      n.inst?.instance.dispose()
      n.comp.disconnect()
      n.cache.disconnect()
      for (const g of n.sends.values()) g.disconnect()
      n.tap.disconnect()
      n.input.disconnect()
      n.fx.dispose()
      n.pan.disconnect()
      n.split.disconnect()
    }
    this.tracks.clear()
    this.master.disconnect()
    this.masterFx.dispose()
    this.masterPan.disconnect()
    this.out.disconnect()
  }

}

/** プロジェクトの FX の列（マスターとトラック）。導入したプラグインの準備に使う */
const fxLists = (p: Project) => [p.master.fx, ...p.tracks.map((t) => t.fx)]

const IOS = typeof navigator !== 'undefined' && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))

/** 再生。位置は AudioContext の時計から求める */
export class Player {
  /** 音を作る処理の負荷（0〜1）が変わったときに呼ぶ。対応していないブラウザでは呼ばない */
  onLoad: ((load: number) => void) | null = null
  /** プラグインが状態を保存したいとき（トラックの id か 'master'、項目の番号、base64） */
  onFxState: ((target: string, index: number, state: string) => void) | null = null
  private meterStarted = false
  /** 再生していないときの、キーボードで鳴らす音のためのグラフ（波形ブロックと MIDI ブロックは持たず、音源と FX の列だけ） */
  private monitor: Graph | null = null
  private monitorKey = ''
  /** 重いプラグインを持つトラックの音を、先に作って鳴らす（設定。anticipate.ts） */
  anticipative = false
  /** 先に作って鳴らしているトラック（id → 音を決めるものの識別、次に作るかたまりの番号） */
  private ant: { sigs: Map<string, string>; next: Map<string, number>; busy: boolean; timer: ReturnType<typeof setInterval> } | null = null
  /** オートメーションを反映し続ける間隔の ID */
  private automation: ReturnType<typeof setInterval> | null = null
  private ctx: AudioContext | null = null
  private graph: Graph | null = null
  private startedAt = 0
  private from = 0
  playing = false
  // play の呼び出しの通し番号（続けて呼ばれたら、待っている途中の古い呼び出しは捨てる）
  private seq = 0
  // play が AudioContext の準備を待っている間
  private starting = false

  /** from 秒から鳴らす（鳴っていれば、古い音を消して新しく始める） */
  async play(p: Project, from: number) {
    // 待っている間に次の play や stop が来たら、この呼び出しは何もしない（古いグラフが残って鳴り続けたり、新しいグラフを壊したりしない）
    const again = this.playing || this.starting
    this.stop()
    this.stopMonitor()
    const id = ++this.seq
    this.starting = true
    this.ctx ??= new AudioContext()
    // iPhone、iPad はマナーモードでも鳴るように、再生の音声セッションにしてから起こす（wevocal-lib。WeVocalSynth と同じ）
    // ミキサー（AudioWorklet）の読み込みも待つ（AudioContext ごとに 1 回だけ）
    await Promise.all([startContext(this.ctx, 'player'), loadMixer(this.ctx), preloadFx(this.ctx, ...fxLists(p)), preloadInstruments(this.ctx, instrumentIds(p))])
    this.startLoadMeter()
    if (id !== this.seq) return
    // 先に作って鳴らすトラックは、最初のかたまりができてから始める（作っている間は、ほかの音も待つ）
    const first = this.anticipative ? p.tracks.filter((t) => anticipated(p, t)) : []
    const k0 = Math.floor(from / CHUNK)
    const primed = await Promise.all(first.map((t) => this.makeChunk(p, t.id, k0).catch(() => null)))
    if (id !== this.seq) return
    this.starting = false
    this.from = from
    // 鳴らし直すときは待たずに続ける（前の音は stop で消えていく）
    this.startedAt = this.ctx.currentTime + (again ? 0.01 : 0.05)
    this.graph = new Graph(this.ctx, this.startedAt - from)
    this.graph.onFxState = this.onFxState
    // 最初のかたまりができたトラックだけを先読みにする（できなかったトラックは今までどおりノードで鳴らす）
    const ok = first.filter((_, i) => primed[i])
    this.graph.setAnticipated(ok.map((t) => t.id))
    this.automation = setInterval(() => {
      this.graph?.automate()
      this.graph?.pumpMidi()
    }, 20)
    if (again) {
      this.graph.out.gain.setValueAtTime(0, this.startedAt)
      this.graph.out.gain.linearRampToValueAtTime(1, this.startedAt + FADE)
    }
    this.graph.sync(p, false)
    this.playing = true
    if (ok.length) {
      this.ant = { sigs: new Map(ok.map((t) => [t.id, signature(p, t)])), next: new Map(ok.map((t) => [t.id, k0 + 1])), busy: false, timer: setInterval(() => void this.tick(), 250) }
      for (const [i, t] of first.entries()) if (primed[i]) this.graph.playChunk(t.id, primed[i]!, k0 * CHUNK)
      this.project = p
    }
    // ピッチを変えた波形ブロックは、ここから近い所（これから鳴る所）から作り直す。できたかたまりから鳴る（update）
    preparePitch(p, from).catch(() => {})
  }

  /** 再生中に変えたものだけを差し替える（位置はそのまま） */
  update(p: Project) {
    if (!this.playing || !this.graph) return
    // 先に作った音の元が変わったトラックは、先読みをやめてノードで鳴らす（次に再生を始めるまで）
    this.project = p
    for (const [id, sig] of this.ant?.sigs ?? []) {
      const t = p.tracks.find((x) => x.id === id)
      if (!t || signature(p, t) !== sig) this.release(id)
    }
    this.graph.sync(p, true)
  }

  stop() {
    this.seq++
    if (this.ant) clearInterval(this.ant.timer)
    this.ant = null
    if (this.automation) clearInterval(this.automation)
    this.automation = null
    this.starting = false
    this.graph?.stopAll()
    this.graph = null
    this.playing = false
  }

  /** トラックのレベルメーター（鳴らしていなければ null） */
  meter = (trackId: string) => (this.playing ? (this.graph?.meter(trackId) ?? null) : null)
  /** マスターの左右のレベルメーター */
  masterMeters = () => (this.playing ? (this.graph?.masterMeters ?? null) : null)

  /** 音を作る処理の負荷を測り始める（wevocal-lib の startRenderLoad。1 秒ごと） */
  private startLoadMeter() {
    if (this.ctx && !this.meterStarted) {
      this.meterStarted = true
      startRenderLoad(this.ctx, (v) => this.onLoad?.(v))
    }
  }

  private project: Project | null = null

  /** 先読みのかたまり k（曲の k * CHUNK 秒から CHUNK 秒）を作って、音を出す ctx の AudioBuffer にする */
  private async makeChunk(p: Project, trackId: string, k: number): Promise<AudioBuffer> {
    const ctx = this.ctx!
    const ch = await renderTrackChunk(p, trackId, k * CHUNK, CHUNK, ctx.sampleRate)
    const buf = ctx.createBuffer(2, ch[0].length, ctx.sampleRate)
    ch.forEach((c, i) => buf.copyToChannel(c as Float32Array<ArrayBuffer>, i))
    return buf
  }

  /** 先読みをやめる（編集したとき、先読みが間に合わなかったとき） */
  private release(id: string) {
    this.graph?.release(id)
    this.ant?.sigs.delete(id)
    this.ant?.next.delete(id)
    // ノードの列に戻すので、今のプロジェクトで組み直す
    if (this.project) this.graph?.sync(this.project, true)
  }

  /** 先読みを進める。再生位置から AHEAD 秒先まで作って音を出す側へ渡し、間に合っていなければ先読みをやめる */
  private async tick() {
    const ant = this.ant
    const p = this.project
    if (!ant || !p || !this.graph || ant.busy) return
    const now = this.position()
    const end = songEnd(p)
    ant.busy = true
    try {
      for (const id of [...ant.next.keys()]) {
        const k = ant.next.get(id)!
        // 作ったかたまりの先頭に再生位置が追いついたら、間に合っていない
        if (k * CHUNK < now) return this.release(id)
        if (k * CHUNK > now + AHEAD || k * CHUNK > end) continue
        const buf = await this.makeChunk(p, id, k)
        // 作っている間に再生が止まったか、先読みがやめられていたら、使わない
        if (this.ant !== ant || !ant.next.has(id)) return
        this.graph.playChunk(id, buf, k * CHUNK)
        ant.next.set(id, k + 1)
      }
    } catch {
      // 作れなかったら、次の周期でもう一度試す（続けて間に合わなければ release になる）
    } finally {
      ant.busy = false
    }
  }

  /** キーボードの音を鳴らす、離す。再生中は再生のグラフの音源で、していなければ、音源と FX の列だけのグラフで鳴らす */
  async monitorNote(p: Project, track: string, pitch: number, vel: number, on: boolean) {
    const send = (g: Graph) => (on ? g.noteOn(track, pitch, vel) : g.noteOff(track, pitch))
    if (this.playing && this.graph) return send(this.graph)
    const ctx = (this.ctx ??= new AudioContext())
    const q: Project = { ...p, blocks: [], midi: [] }
    // 音源と FX の列、音量、パンが変わったときだけ組み直す
    const key = JSON.stringify([p.tracks.map((t) => [t.id, t.instrument, t.fx, t.volume, t.pan, t.invert, t.mute, t.solo, t.parent]), p.master, p.tempo.bpm])
    if (!this.monitor || key !== this.monitorKey) {
      await Promise.all([startContext(ctx, 'player'), loadMixer(ctx), preloadFx(ctx, ...fxLists(q)), preloadInstruments(ctx, instrumentIds(q))])
      if (this.playing) return
      this.monitor ??= new Graph(ctx, 0)
      this.monitor.sync(q, false)
      this.monitorKey = key
    }
    send(this.monitor)
  }

  /** キーボードのモニターのグラフを止める（再生を始めるとき） */
  private stopMonitor() {
    this.monitor?.stopAll()
    this.monitor = null
    this.monitorKey = ''
  }

  /** 今の位置（秒） */
  position() {
    return this.ctx && this.playing ? this.from + Math.max(0, this.ctx.currentTime - this.startedAt - this.outputLatency()) : this.from
  }

  /**
   * 音が出口に着くまでの遅れ（秒）。currentTime は音を作った時刻なので、スピーカーから聞こえるのはこの分あとになる。
   * 再生位置の表示をこの分だけ遅らせて、聞こえる音と合わせる（iPad や Bluetooth のように遅れが大きいと、位置だけ先に進んで見えていた）
   */
  private outputLatency() {
    const c = this.ctx
    if (!c) return 0
    // outputLatency を持たないブラウザ（iPhone、iPad の Safari）は、基本の遅れに、よくある出口の遅れの分を足す。足りない分は、設定の補正で足す
    const base = c.outputLatency || (c.baseLatency || 0) + (IOS ? 0.06 : 0)
    return Math.max(0, base + this.offsetMs / 1000)
  }
  /** 設定の「再生位置の補正」（ms） */
  offsetMs = 0
}

/**
 * オートメーションがあれば、一定の間隔（128 サンプルの倍数の時刻）でレンダリングを止めて、つまみを動かす。
 * offset は、描画の 0 秒が曲の何秒か（先に作る音は途中から描くので、その時刻の値にする）
 */
function scheduleAutomation(ctx: OfflineAudioContext, graph: Graph, length: number, sampleRate: number, offset: number) {
  if (!graph.automated) return
  const step = 0.025
  const done = new Set<number>()
  for (let t = step; t < length / sampleRate; t += step) {
    const q = Math.round((t * sampleRate) / 128) * 128
    if (done.has(q) || q >= length) continue
    done.add(q)
    void ctx.suspend(q / sampleRate).then(() => {
      graph.automate(offset + q / sampleRate)
      void ctx.resume()
    })
  }
}

/** 全トラックをマスターまで混ぜた音（ステレオ）。書き出しの形式にするのは wevocal-lib の exportAudio */
/** until を渡すと、そこまでの長さにする（範囲選択が曲の終わりより後ろまであるとき） */
export async function renderMix(p: Project, until = 0, sampleRate = 48000): Promise<Clip> {
  await preparePitch(p)
  const length = Math.max(1, Math.ceil(Math.max(songEnd(p), until) * sampleRate))
  const ctx = new OfflineAudioContext(2, length, sampleRate)
  // 再生と同じミキサーで作る（再生と書き出しの音が一致する）。送ったものを受け取ってから始める
  await Promise.all([loadMixer(ctx), preloadFx(ctx, ...fxLists(p)), preloadInstruments(ctx, instrumentIds(p))])
  const graph = new Graph(ctx, 0)
  graph.sync(p, false)
  await graph.flush()
  scheduleAutomation(ctx, graph, length, sampleRate, 0)
  const out = await ctx.startRendering()
  return { sampleRate, channels: [out.getChannelData(0), out.getChannelData(1)] }
}


/**
 * 1 本のトラックの、曲の時刻 start から dur 秒の音（ステレオ。音量、位相の反転、FX の列まで。パンとミュート、ソロは含めない）。
 * 先に作って鳴らす（anticipate.ts）ためのもの。状態を作るため、PREROLL 秒前から流して、その分は捨てる
 */
export async function renderTrackChunk(p: Project, trackId: string, start: number, dur: number, sampleRate: number): Promise<Float32Array[]> {
  const track = p.tracks.find((t) => t.id === trackId)
  if (!track) throw new Error('track not found')
  const t0 = Math.max(0, start - PREROLL)
  const lead = start - t0
  const q: Project = {
    ...p,
    master: { volume: 0, pan: 0, mute: false },
    tracks: [{ ...track, parent: undefined, pan: 0, mute: false, solo: false, sends: [], autoLane: undefined }],
    blocks: p.blocks.filter((b) => b.track === trackId),
    midi: (p.midi ?? []).filter((b) => b.track === trackId),
  }
  await preparePitch(q)
  const length = Math.max(128, Math.ceil((lead + dur) * sampleRate))
  const ctx = new OfflineAudioContext(2, length, sampleRate)
  await Promise.all([loadMixer(ctx), preloadFx(ctx, ...fxLists(q)), preloadInstruments(ctx, instrumentIds(q))])
  const graph = new Graph(ctx, -t0)
  graph.sync(q, false)
  await graph.flush()
  scheduleAutomation(ctx, graph, length, sampleRate, t0)
  const out = await ctx.startRendering()
  const from = Math.round(lead * sampleRate)
  return [out.getChannelData(0).slice(from), out.getChannelData(1).slice(from)]
}

/**
 * 1 本のトラックだけを混ぜた音（ステレオ。長さは `length` 秒）。.wvsp への書き出し用。
 * 波形ブロックの加工、トラックの FX の列、先祖のトラックのフェーダーと FX は音に含める。
 * 自分の音量、パン、位相の反転、ミュート、ソロは含めない（書き出し先のトラックの状態として渡す）
 */
export async function renderTrack(p: Project, trackId: string, length: number, sampleRate = 48000): Promise<Clip> {
  const track = p.tracks.find((t) => t.id === trackId)
  if (!track) throw new Error('track not found')
  const chain = [...ancestors(p, track).reverse(), track]
  const tracks = chain.map((t) => (t === track ? { ...t, volume: 0, pan: 0, invert: false, mute: false, solo: false } : { ...t, mute: false, solo: false }))
  const q: Project = { ...p, master: { volume: 0, pan: 0, mute: false }, tracks, blocks: p.blocks.filter((b) => b.track === trackId), midi: (p.midi ?? []).filter((b) => b.track === trackId) }
  return renderMix(q, length, sampleRate)
}
