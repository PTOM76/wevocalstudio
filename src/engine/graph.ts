// 再生と書き出しの音のグラフ。トラックごとのミキサー、FX の列、パン、メーター、マスターをつなぎ、プロジェクトの変更に合わせて組み替える
import { FADE, midiSig, setParam, trackLatency, volumeSteps } from './params'
import { controlEvents, noteEvents } from './midiEvents'
import { clipFor } from '../dsp/pitch'
import { samplerShifts } from '../dsp/samplerPitch'
import { createInstrument, findInstrument, type InstrumentInstance } from 'wevocal-lib'
import { automatedSlots, createFxChain, hasAutomation, type ChainOptions, createLimitedOutput, type Clip, type FxChain } from 'wevocal-lib'
import { clipId, Mixers, voicesOf } from '../mixer/mixer'
import type { Voice } from '../mixer/types'
import { piecesFor, type Piece } from '../dsp/pitch'
import { audible, bakedTracks, ownAudible, flowsTo, SEND_MIN, dbToGain, liveSlots, type Block, type Project, type Track } from '../project'

export interface TrackNodes {
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
  inst: { key: string; instance: InstrumentInstance; sig: string; sentUntil: number; /** 高さごとの音（フォルマント保持）の、できている高さの印 */ fsig: string } | null
}

/** 組んだノード（トラックごとの入口とミキサー、マスター） */
export class Graph {
  readonly out: GainNode
  /** マスターの左右のレベルメーター */
  readonly masterMeters: [AnalyserNode, AnalyserNode]
  /** マスターのメーターに分ける所（外すときに切り離す。AnalyserNode は入力がつながっている限り、出力先がなくても毎回処理され、解放もされない） */
  private readonly masterSplit: ChannelSplitterNode
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
  private zero: number
  /** 先に作った音で鳴らすトラック（波形ブロックと FX の列は動かさない） */
  private anticipated = new Set<string>()
  /** 先に作った音の再生（トラックごと。止めるときに使う） */
  private cacheSources = new Map<string, AudioBufferSourceNode[]>()
  /** 先に作った音ごとの音量（やめるとき、ぷつっと切れないよう、短く下げてから止める） */
  private cacheGains = new WeakMap<AudioBufferSourceNode, GainNode>()
  /** 最後に同期したプロジェクト（サイドチェーンの輪を作らないかの確認に使う） */
  private proj: Project | null = null
  /** 再生の出口のリミッター（書き出しは通さない） */
  private readonly limiter: AudioNode | null
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
    this.masterFx.setTransport(this.transport())
    // 再生は耳とスピーカーを守るリミッターを通す（wevocal-lib。WeVocalSynth と同じ）。書き出しは通さない
    this.master.connect(this.masterFx.input)
    // リミッターは再生ごとに作る（どこかで壊れた値が一度入っても、次の再生に残さない）
    this.limiter = ctx instanceof AudioContext ? createLimitedOutput(ctx) : null
    this.masterFx.output.connect(this.masterPan).connect(this.out).connect(this.limiter ?? ctx.destination)
    // 左右に分けて別々に測る（AnalyserNode はチャンネルを混ぜて読むため。WeVocalSynth と同じ）
    const split = (this.masterSplit = ctx.createChannelSplitter(2))
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
    return this.anticipated.has(t.id) ? [] : liveSlots(t)
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
    const gain = this.ctx.createGain()
    src.connect(gain)
    gain.connect(n.cache)
    this.cacheGains.set(src, gain)
    const when = this.zero + start
    const now = this.ctx.currentTime
    if (when >= now) src.start(when)
    else if (now - when < buffer.duration) src.start(now, now - when)
    else {
      // もう鳴り終わっている所なら鳴らさない（始めないと onended が来ず、つないだまま残る）
      src.disconnect()
      gain.disconnect()
      return
    }
    const list = this.cacheSources.get(trackId) ?? []
    list.push(src)
    this.cacheSources.set(trackId, list)
    src.onended = () => {
      this.cacheSources.set(trackId, (this.cacheSources.get(trackId) ?? []).filter((x) => x !== src))
      // 鳴り終えたノードは外す（長く再生すると、かたまりごとにつないだままのノードが溜まる）
      src.disconnect()
      gain.disconnect()
    }
  }

  /** 先に作った音を入れる所（音量と FX の列の後、パンの前） */
  cacheInput(trackId: string): AudioNode | null {
    return this.tracks.get(trackId)?.cache ?? null
  }

  /** 先に作った音をやめ、ノードの FX の列と波形ブロックの声で鳴らす（編集したときと、先読みが間に合わなかったとき） */
  release(trackId: string, fade = true) {
    const now = this.ctx.currentTime
    for (const s of this.cacheSources.get(trackId) ?? []) {
      const gain = this.cacheGains.get(s)
      const stop = () => {
        try {
          s.stop()
        } catch {
          // まだ始まっていないものは止められる。終わったものは無視
        }
        s.disconnect()
        gain?.disconnect()
      }
      // 鳴っている途中で切ると、ぷつっと音がする。短く下げてから止める（ノードの列の音とは重なるが、一瞬）
      if (fade && gain && this.ctx.state === 'running') {
        gain.gain.setTargetAtTime(0, now, FADE / 3)
        setTimeout(stop, FADE * 4 * 1000)
      } else stop()
    }
    this.cacheSources.delete(trackId)
    this.anticipated.delete(trackId)
  }

  /** 音源の組み立て: トラックに音源があれば作り、変わっていれば作り直し、なければ外す。書き出しは音符を全部、作るときに渡す */
  private syncInstrument(p: Project, t: Track, n: TrackNodes) {
    const spec = t.instrument
    // フリーズしたトラックとそのサブトラックの音符は、書き出した音に入っているので鳴らさない
    const plugin = spec && !this.anticipated.has(t.id) && !bakedTracks(p).has(t.id) ? findInstrument(spec.plugin) : undefined
    const key = plugin ? `${spec!.plugin}|${spec!.sample ?? ''}` : ''
    if (n.inst && n.inst.key !== key) {
      n.inst.instance.dispose()
      n.inst = null
    }
    if (!plugin || !spec) return
    const live = this.ctx instanceof AudioContext
    // フォルマント保持の音（作るのにも探すのにも手間がかかるので、1 回だけ求める）
    const samples = pitchedSamples(p, t)
    if (!n.inst) {
      const src = spec.sample ? p.sources.find((s) => s.id === spec.sample) : undefined
      const sample = src ? { channels: src.clip.channels, sampleRate: src.clip.sampleRate } : null
      const instance = createInstrument(this.ctx, plugin, spec.values, { events: live ? [] : noteEvents(p, t.id, -Infinity, Infinity, this.zero), controls: live ? [] : controlEvents(p, t.id, -Infinity, Infinity, this.zero), sample, samples })
      instance.output.connect(n.comp)
      n.inst = { key, instance, sig: midiSig(p, t.id), sentUntil: this.timeNow(), fsig: Object.keys(samples).join(',') }
    }
    n.inst.instance.update(spec.values)
    // フォルマント保持の音ができたら差し替える
    const fsig = Object.keys(samples).join(',')
    if (fsig !== n.inst.fsig) {
      n.inst.instance.setSamples(samples)
      n.inst.fsig = fsig
    }
    const sig = midiSig(p, t.id)
    if (live && sig !== n.inst.sig) {
      // 音符が変わったら、送った音符を取り消して、今から送り直す
      n.inst.instance.clear()
      n.inst.sig = sig
      n.inst.sentUntil = this.timeNow()
    }
  }

  /** 時間軸の起点だけを付け替える（再生位置を変えたとき。グラフは作り直さず、声と音符を新しい位置で送り直す。声は FADE でつながる） */
  reposition(p: Project, zero: number) {
    this.zero = zero
    // 位置に合わせて動くプラグインにも、新しい起点を伝える
    this.masterFx.setTransport(this.transport())
    for (const n of this.tracks.values()) n.fx.setTransport(this.transport())
    for (const n of this.tracks.values()) {
      if (!n.inst) continue
      n.inst.instance.clear()
      n.inst.sentUntil = this.timeNow()
    }
    this.sync(p, true)
  }

  /** 再生中、これから 0.5 秒ぶんの音符を音源へ送る（時刻つきなので、遅れずに正確に鳴る）。一定の間隔で呼ぶ */
  pumpMidi() {
    const p = this.proj
    if (!p || !(this.ctx instanceof AudioContext)) return
    const to = this.timeNow() + 0.5
    for (const t of p.tracks) {
      const n = this.tracks.get(t.id)
      if (!n?.inst) continue
      n.inst.instance.schedule(noteEvents(p, t.id, n.inst.sentUntil, to, this.zero))
      n.inst.instance.scheduleControls(controlEvents(p, t.id, n.inst.sentUntil, to, this.zero))
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
  /** そのトラックに、今動いている音源があるか（先読みのトラックやフリーズ中は、再生のグラフに音源がない） */
  hasInstrument(track: string) {
    return !!this.tracks.get(track)?.inst
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
    for (const tr of p.tracks) if (hasAutomation(liveSlots(tr)) && !this.anticipated.has(tr.id)) this.tracks.get(tr.id)?.fx.update(automatedSlots(liveSlots(tr), t))
  }

  /** プラグインに渡すホストの情報 */
  private readonly host = { bpm: () => this.bpm }

  /** プラグインに伝える曲の位置（位置 0 にあたる時刻とテンポ） */
  private transport() {
    return { zero: this.zero, bpm: this.bpm }
  }

  /** レベルメーター用の AnalyserNode（時間波形を読むだけなので小さくてよい） */
  private static analyser(ctx: BaseAudioContext) {
    const a = ctx.createAnalyser()
    a.fftSize = 1024
    return a
  }

  /** トラックのレベルメーター */
  /** デバッグ表示の行（トラックごとの FX の列と、先に作った音の数。読んだときだけ作る） */
  debugLines(): string[] {
    const name = (id: string) => this.proj?.tracks.find((t) => t.id === id)?.name ?? id
    const lines = [`fx master: ${this.masterFx.describe().join(', ') || '-'}`]
    for (const [id, n] of this.tracks) {
      const fx = n.fx.describe()
      const chunks = this.cacheSources.get(id)?.length ?? 0
      if (!fx.length && !n.inst && !this.anticipated.has(id)) continue
      const ant = this.anticipated.has(id) ? ` [anticipated ${chunks} chunks]` : ''
      lines.push(`fx ${name(id)}: ${fx.join(', ') || '-'}${n.inst ? ` +${n.inst.key.split('|')[0]}` : ''}${ant}`)
    }
    return lines
  }

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
    fx.setTransport(this.transport())
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
    const to = (param: AudioParam, v: number, now: boolean) => setParam(param, v, now ? null : at)
    to(this.master.gain, p.master.mute ? 0 : dbToGain(p.master.volume), first)
    to(this.masterPan.pan, p.master.pan, first)
    for (const t of p.tracks) {
      let n = this.tracks.get(t.id)
      const fresh = !n
      if (!n) {
        n = this.buildTrack(t)
        this.tracks.set(t.id, n)
      } else n.fx.update(automatedSlots(this.liveFx(t), now))
      to(n.cache.gain, ownAudible(p, t) ? 1 : 0, fresh)
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
        setParam(g.gain, dbToGain(db), at)
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
      n.inst?.instance.dispose()
      n.comp.disconnect()
      n.cache.disconnect()
      for (const g of n.sends.values()) g.disconnect()
      n.tap.disconnect()
      n.input.disconnect()
      n.fx.dispose()
      n.pan.disconnect()
      n.split.disconnect()
      this.tracks.delete(id)
    }

    // 波形ブロックの片を、トラックごとの声にする（作ったかたまりの片。変えていなければ元の音。できていない所は鳴らさない）
    const voices = new Map<string, Voice[]>(p.tracks.map((t) => [t.id, []]))
    const used = new Map<number, Clip>()
    const frozen = new Set<string>()
    for (const t of p.tracks) {
      const src = t.frozen && p.sources.find((s) => s.id === t.frozen!.source)
      if (!t.frozen || !src) continue
      if (!ownAudible(p, t)) {
        frozen.add(t.id)
        continue
      }
      // フリーズしたトラックは、書き出した音を 1 つの声として鳴らす（波形ブロックは鳴らさない）
      frozen.add(t.id)
      const id = clipId(src.clip)
      used.set(id, src.clip)
      const t0 = this.zero + t.frozen.start
      const t1 = t0 + src.duration
      voices.get(t.id)!.push({ key: `freeze:${t.id}:${id}`, sig: `${t0}`, t0, t1, clip: id, f0: 0, bt0: t0, bt1: t1, fadeIn: 0, fadeOut: 0, joinIn: 0, joinOut: 0, level: 1, env: [] })
    }
    // 元の音と、鳴るトラックは一度だけ引く（波形ブロックごとに全体を探さない。ドラッグ中は 50 ms ごとに走る）
    const sources = new Map(p.sources.map((s) => [s.id, s]))
    const audibleTracks = new Set(p.tracks.filter((t) => ownAudible(p, t)).map((t) => t.id))
    const baked = bakedTracks(p)
    for (const b of p.blocks) {
      const source = sources.get(b.source)
      const list = voices.get(b.track)
      // フリーズしたトラックのサブトラックの波形ブロックも、書き出した音に入っているので鳴らさない
      if (b.mute || !source || !list || frozen.has(b.track) || baked.has(b.track) || this.anticipated.has(b.track) || !audibleTracks.has(b.track)) continue
      const pieces = piecesFor(b, source)
      if (!pieces.length) continue
      for (const pc of pieces) used.set(clipId(pc.clip), pc.clip)
      list.push(...this.blockVoices(b, pieces))
    }
    // FX の遅れ（秒）が違うトラックをそろえる: 波形ブロックから出口までの遅れが、どのトラックも同じになるように入口で遅らせる
    const late = new Map(p.tracks.map((t) => [t.id, trackLatency(p, t, this.ctx.sampleRate)]))
    const slowest = Math.max(0, ...late.values())
    for (const t of p.tracks) {
      const n = this.tracks.get(t.id)!
      setParam(n.comp.delayTime, Math.min(1, slowest - late.get(t.id)!), at)
      this.mixers.node(t.id, n.comp)
    }
    this.mixers.syncClips(used, new Set(p.sources.map((s) => clipId(s.clip))))
    for (const [id, list] of voices) this.mixers.voices(id, list, smooth)
  }

  /** 波形ブロックの声。波形ブロック（書き換えずに作り直すので参照で比べる）、起点、片が前と同じなら前のものを使う（ドラッグ中は 50 ms ごとに全部の波形ブロックで呼ぶ） */
  private blockVoices(b: Block, pieces: Piece[]): Voice[] {
    const c = this.voiceCache.get(b)
    if (c && c.zero === this.zero && c.pieces.length === pieces.length && c.pieces.every((x, i) => x.clip === pieces[i].clip && x.a === pieces[i].a && x.z === pieces[i].z && x.from === pieces[i].from)) return c.voices
    const t0 = this.zero + b.start
    const env = volumeSteps(b.envelope ?? []).flatMap((pt) => [t0 + pt.t, dbToGain(pt.db)])
    const voices = voicesOf(b, pieces, this.zero, dbToGain(b.gain), env)
    this.voiceCache.set(b, { zero: this.zero, pieces, voices })
    return voices
  }
  private voiceCache = new WeakMap<Block, { zero: number; pieces: Piece[]; voices: Voice[] }>()

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

  /** ノードを全部外す（オフラインの描画が終わったあとも呼ぶ。FX のプロセッサーと音源を残さない） */
  dispose() {
    for (const id of [...this.cacheSources.keys()]) this.release(id, false)
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
    this.limiter?.disconnect()
    this.masterSplit.disconnect()
  }

}

/** サンプラーのフォルマント保持: 音符の高さに合わせて作り終えた音（高さごと）。作っている途中の高さは含めない（速度を変えて鳴らす） */
function pitchedSamples(p: Project, t: Track) {
  const out: Record<number, { channels: Float32Array[]; sampleRate: number }> = {}
  for (const s of samplerShifts(p)) {
    const source = s.track === t.id ? p.sources.find((x) => x.id === s.block.source) : undefined
    const made = source && clipFor(s.block, source)
    if (made) out[s.pitch] = { channels: made.clip.channels, sampleRate: made.clip.sampleRate }
  }
  return out
}
