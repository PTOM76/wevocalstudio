// 再生と書き出し。波形ブロックの音は、トラックごとのミキサー（AudioWorklet）が 128 サンプルずつ今かかっている所だけを読んで足す。
// トラックの FX の列、パン、メーターとマスターは Web Audio のノード。再生中に変えたときは、声の一覧を送り直し、トラックとマスターは値だけを変える
import { chainLatency, createFxChain, limitedOutput, preloadFx, startContext, startRenderLoad, type Clip, type FxChain } from 'wevocal-lib'
import { clipId, loadMixer, Mixers, voicesOf } from './mixer/mixer'
import type { Voice } from './mixer/types'
import { piecesFor, preparePitch } from './dsp/pitch'
import { ancestors, audible, dbToGain, songEnd, type Project, type Track } from './project'

/** 鳴らし直すとき、差し替えるときのつなぎ（秒） */
const FADE = 0.02
interface TrackNodes {
  input: GainNode
  /** 波形ブロックの音の入口。FX の遅れ（latency）をそろえるため、遅れの少ないトラックを遅らせる（子のトラックの音は入らない） */
  comp: DelayNode
  pan: StereoPannerNode
  /** レベルメーターの入口（パンのあと）と、左右の AnalyserNode（WeVocalSynth と同じく左右を別に測る） */
  split: ChannelSplitterNode
  meter: [AnalyserNode, AnalyserNode]
  /** 出し先（親のトラックの id か 'master'。変わったときだけつなぎ直す） */
  dest: string
  /** FX の列（WeVocal プラグイン。鳴らしたまま値を変える。wevocal-lib） */
  fx: FxChain
}
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

  constructor(ctx: BaseAudioContext, zero: number) {
    this.ctx = ctx
    this.zero = zero
    this.mixers = new Mixers(ctx)
    this.master = ctx.createGain()
    this.masterPan = ctx.createStereoPanner()
    this.out = ctx.createGain()
    this.masterFx = createFxChain(ctx, [], this.host)
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
    comp.connect(input)
    const pan = this.ctx.createStereoPanner()
    // トラック: 音量 → FX の列 → パン → マスター
    const fx = createFxChain(this.ctx, t.fx ?? [], this.host)
    input.connect(fx.input)
    fx.output.connect(pan)
    const split = this.ctx.createChannelSplitter(2)
    const meter: [AnalyserNode, AnalyserNode] = [Graph.analyser(this.ctx), Graph.analyser(this.ctx)]
    pan.connect(split)
    split.connect(meter[0], 0)
    split.connect(meter[1], 1)
    // 出し先（マスターか親のトラック）は sync でつなぐ
    return { input, comp, pan, fx, split, meter, dest: '' }
  }

  /** 波形ブロックの声の一覧をミキサーに送る。変わっていない声はそのまま鳴り続け、差し替えた声は FADE でつなぐ（smooth のとき） */
  sync(p: Project, smooth: boolean) {
    // マスターとトラックの値（鳴らしたまま変える）
    const at = this.ctx.currentTime
    this.bpm = p.tempo.bpm
    this.masterFx.update(p.master.fx ?? [])
    this.master.gain.setTargetAtTime(p.master.mute ? 0 : dbToGain(p.master.volume), at, 0.01)
    this.masterPan.pan.setTargetAtTime(p.master.pan, at, 0.01)
    for (const t of p.tracks) {
      let n = this.tracks.get(t.id)
      if (!n) {
        n = this.buildTrack(t)
        this.tracks.set(t.id, n)
      } else n.fx.update(t.fx ?? [])
      // ミュートとソロは音量 0 にする（ノードは残す）
      n.input.gain.setTargetAtTime(audible(p, t) ? dbToGain(t.volume) * (t.invert ? -1 : 1) : 0, at, 0.01)
      n.pan.pan.setTargetAtTime(t.pan, at, 0.01)
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
      }
      n.pan.connect(parent ? parent.input : this.master)
      n.dest = dest
    }
    for (const [id, n] of this.tracks) {
      if (p.tracks.some((t) => t.id === id)) continue
      this.mixers.drop(id)
      n.comp.disconnect()
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
      if (b.mute || !source || !list || frozen.has(b.track)) continue
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
    this.mixers.disconnect()
    for (const n of this.tracks.values()) {
      n.comp.disconnect()
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

/** 再生。位置は AudioContext の時計から求める */
export class Player {
  /** 音を作る処理の負荷（0〜1）が変わったときに呼ぶ。対応していないブラウザでは呼ばない */
  onLoad: ((load: number) => void) | null = null
  private meterStarted = false
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
    const id = ++this.seq
    this.starting = true
    this.ctx ??= new AudioContext()
    // iPhone、iPad はマナーモードでも鳴るように、再生の音声セッションにしてから起こす（wevocal-lib。WeVocalSynth と同じ）
    // ミキサー（AudioWorklet）の読み込みも待つ（AudioContext ごとに 1 回だけ）
    await Promise.all([startContext(this.ctx, 'player'), loadMixer(this.ctx), preloadFx(this.ctx, ...fxLists(p))])
    this.startLoadMeter()
    if (id !== this.seq) return
    this.starting = false
    this.from = from
    // 鳴らし直すときは待たずに続ける（前の音は stop で消えていく）
    this.startedAt = this.ctx.currentTime + (again ? 0.01 : 0.05)
    this.graph = new Graph(this.ctx, this.startedAt - from)
    if (again) {
      this.graph.out.gain.setValueAtTime(0, this.startedAt)
      this.graph.out.gain.linearRampToValueAtTime(1, this.startedAt + FADE)
    }
    this.graph.sync(p, false)
    this.playing = true
    // ピッチを変えた波形ブロックは、ここから近い所（これから鳴る所）から作り直す。できたかたまりから鳴る（update）
    preparePitch(p, from).catch(() => {})
  }

  /** 再生中に変えたものだけを差し替える（位置はそのまま） */
  update(p: Project) {
    if (!this.playing || !this.graph) return
    this.graph.sync(p, true)
  }

  stop() {
    this.seq++
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

  /** 今の位置（秒） */
  position() {
    return this.ctx && this.playing ? this.from + Math.max(0, this.ctx.currentTime - this.startedAt) : this.from
  }
}

/** 全トラックをマスターまで混ぜた音（ステレオ）。書き出しの形式にするのは wevocal-lib の exportAudio */
/** until を渡すと、そこまでの長さにする（範囲選択が曲の終わりより後ろまであるとき） */
export async function renderMix(p: Project, until = 0, sampleRate = 48000): Promise<Clip> {
  await preparePitch(p)
  const length = Math.max(1, Math.ceil(Math.max(songEnd(p), until) * sampleRate))
  const ctx = new OfflineAudioContext(2, length, sampleRate)
  // 再生と同じミキサーで作る（再生と書き出しの音が一致する）。送ったものを受け取ってから始める
  await Promise.all([loadMixer(ctx), preloadFx(ctx, ...fxLists(p))])
  const graph = new Graph(ctx, 0)
  graph.sync(p, false)
  await graph.flush()
  const out = await ctx.startRendering()
  return { sampleRate, channels: [out.getChannelData(0), out.getChannelData(1)] }
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
  const q: Project = { ...p, master: { volume: 0, pan: 0, mute: false }, tracks, blocks: p.blocks.filter((b) => b.track === trackId) }
  return renderMix(q, length, sampleRate)
}
