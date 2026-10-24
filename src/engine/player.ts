// 再生。位置は AudioContext の時計から求め、グラフを組んで鳴らす（先に作った音、鍵盤の音の試聴を含む）
import { FADE, IOS, MIN_REBUILD, MIN_SEEK, MONITOR_MIN, fxLists, instrumentIds, maxTrackLatency } from './params'
import { renderTrackChunk } from './render'
import { Graph } from './graph'
import { AHEAD, anticipated, CHUNK, excludedReason, signature } from '../anticipate'
import { AntGauge } from './antGauge'
import { ChunkCache, chunkKey } from '../fxCache'
import { preloadInstruments } from 'wevocal-lib'
import { liveProcessors, renderLoad } from 'wevocal-lib'
import { preloadFx, startContext, suspendContext, startRenderLoad } from 'wevocal-lib'
import { loadMixer } from '../mixer/mixer'
import { preparePitch } from '../dsp/pitch'
import { wantSamplerPitch } from '../dsp/samplerPitch'
import { songEnd, type Project } from '../project'
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
  /** 鳴らしている鍵盤の音を鳴らし始めた時刻（トラックと高さごと） */
  private monitorOn = new Map<string, number>()
  /** 重いプラグインを持つトラックの音を、先に作って鳴らす（設定。anticipate.ts） */
  anticipative = false
  /** 先に計算した量を状態バーのゲージに出す（設定。label が null なら出さない） */
  readonly gauge = new AntGauge()
  /** 先に作って鳴らしているトラック（id → 音を決めるものの識別、次に作るかたまりの番号） */
  private ant: { sigs: Map<string, string>; next: Map<string, number>; busy: boolean; timer: ReturnType<typeof setInterval> } | null = null
  /** オートメーションを反映し続ける間隔の ID */
  private automation: ReturnType<typeof setInterval> | null = null
  private ctx: AudioContext | null = null
  private graph: Graph | null = null
  private startedAt = 0
  private from = 0
  private fxLatency = 0
  playing = false
  // play の呼び出しの通し番号（続けて呼ばれたら、待っている途中の古い呼び出しは捨てる）
  private seq = 0
  // play が AudioContext の準備を待っている間
  private starting = false

  /** 再生位置を続けて変えたときのまとめ（最後の呼び出しの通し番号と、最後にグラフを組んだ時刻） */
  private latest = 0
  private lastBuild = 0

  /** from 秒から鳴らす。続けて呼ばれたら、グラフの組み直しは MIN_REBUILD ごとに 1 回までにして、最後の呼び出しだけを使う（連打でノードの作り直しが溜まって不安定になるため） */
  async play(p: Project, from: number) {
    const id = ++this.latest
    // 鳴らしたまま位置だけ動かせるときは短い間隔でよい（グラフを作り直さない）
    const light = this.playing && !!this.graph && !this.ant
    const wait = this.lastBuild + (light ? MIN_SEEK : MIN_REBUILD) * 1000 - performance.now()
    if (wait > 0) {
      await new Promise((r) => setTimeout(r, wait))
      if (id !== this.latest) return
    }
    this.lastBuild = performance.now()
    await this.start(p, from)
  }

  /** from 秒から鳴らす（鳴っていれば、古い音を消して新しく始める） */
  private async start(p: Project, from: number) {
    // 鳴っていて、先読みの音がなければ、グラフはそのまま、起点だけを付け替える
    if (this.playing && this.graph && this.ctx && !this.ant) {
      this.from = from
      this.startedAt = this.ctx.currentTime + 0.01
      this.fxLatency = maxTrackLatency(p, this.ctx.sampleRate)
      this.graph.reposition(p, this.startedAt - from)
      preparePitch(p, from).catch(() => {})
      return
    }
    // 待っている間に次の play や stop が来たら、この呼び出しは何もしない（古いグラフが残って鳴り続けたり、新しいグラフを壊したりしない）
    const again = this.playing || this.starting
    this.warmSeq++
    this.halt()
    this.stopMonitor()
    const id = ++this.seq
    this.starting = true
    this.ctx ??= new AudioContext()
    this.fxLatency = maxTrackLatency(p, this.ctx.sampleRate)
    // iPhone、iPad はマナーモードでも鳴るように、再生の音声セッションにしてから起こす（wevocal-lib。WeVocalSynth と同じ）
    // ミキサー（AudioWorklet）の読み込みも待つ（AudioContext ごとに 1 回だけ）
    await Promise.all([startContext(this.ctx, 'player'), loadMixer(this.ctx), preloadFx(this.ctx, ...fxLists(p)), preloadInstruments(this.ctx, instrumentIds(p))])
    this.startLoadMeter()
    if (id !== this.seq) return
    // 先に作って鳴らすトラックは、最初のかたまりができてから始める（作っている間は、ほかの音も待つ）
    const first = this.anticipative ? p.tracks.filter((t) => anticipated(p, t)) : []
    this.antInfo = !this.anticipative ? 'off' : first.length ? `${first.length} tracks` : 'no target track'
    // 重いプラグインがあるのに対象にならなかったトラックと、その理由
    const skipped = p.tracks.flatMap((t) => {
      const why = this.anticipative ? excludedReason(p, t) : null
      return why ? [`${t.name}: ${why}`] : []
    })
    if (skipped.length) this.antInfo += ` / skipped ${skipped.join(', ')}`
    const k0 = Math.floor(from / CHUNK)
    const primed = await Promise.all(
      first.map((t) =>
        this.makeChunk(p, t.id, k0).catch((e: unknown) => {
          // 作れなかったトラックはノードで鳴らす。理由はデバッグ表示とコンソールに出す
          this.antInfo = `failed: ${String(e)}`
          console.warn('anticipate:', e)
          return null
        }),
      ),
    )
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
      this.fxLatency = maxTrackLatency(p, this.ctx!.sampleRate)
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
    // 待っている play があれば捨てる
    this.latest++
    this.halt()
    // フェードが終わってから、音声処理を止める（設定でオフなら suspendContext が何もしない。再生や鍵盤の音が始まっていれば止めない）
    const ctx = this.ctx
    if (ctx)
      setTimeout(() => {
        if (!this.playing && !this.starting && !this.monitor) suspendContext(ctx, 'player')
      }, FADE * 4 * 1000 + 50)
  }

  /** 鳴っている音を止める（play の組み直しからも使う。待っている play は捨てない） */
  private halt() {
    this.seq++
    if (this.ant) clearInterval(this.ant.timer)
    this.ant = null
    this.gauge.clearAll()
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

  /** デバッグ表示の行（デバッグ表示を出しているときだけ呼ばれる。再生していなければ状態だけ） */
  debugLines(): string[] {
    const g = this.graph ?? this.monitor
    const state = this.playing ? 'playing' : this.starting ? 'starting' : this.monitor ? 'monitor' : 'stopped'
    const load = renderLoad()
    return [`player ${state}${this.ant ? ` anticipating ${this.ant.next.size}` : ''} processors ${liveProcessors()}${load !== undefined ? ` load ${Math.round(load * 100)}%` : ''}`, `fx cache ${this.chunks.describe()} (anticipate ${this.antInfo})`, ...(g?.debugLines() ?? [])]
  }

  /** 音を作る処理の負荷を測り始める（wevocal-lib の startRenderLoad。1 秒ごと） */
  private startLoadMeter() {
    if (this.ctx && !this.meterStarted) {
      this.meterStarted = true
      startRenderLoad(this.ctx, (v) => this.onLoad?.(v))
    }
  }

  private project: Project | null = null

  /** 先読みのかたまり k（曲の k * CHUNK 秒から CHUNK 秒）を作って、音を出す ctx の AudioBuffer にする */
  /** 作ったかたまりは再生をまたいで取っておき、同じトラックの同じ音、同じ位置なら描かずに使う（fxCache.ts） */
  private makeChunk(p: Project, trackId: string, k: number): Promise<AudioBuffer> {
    const ctx = this.ctx!
    return this.chunks.get(chunkKey(p, trackId, k), async () => {
      const ch = await renderTrackChunk(p, trackId, k * CHUNK, CHUNK, ctx.sampleRate)
      const buf = ctx.createBuffer(2, ch[0].length, ctx.sampleRate)
      ch.forEach((c, i) => buf.copyToChannel(c as Float32Array<ArrayBuffer>, i))
      return buf
    })
  }

  private warmSeq = 0
  /**
   * 止めている間に、from 秒から AHEAD 秒先まで、先に計算するトラックのかたまりを作って取っておく（memo/fx-cache.md の 3）。
   * 再生を始めたら、次のかたまりから作らない（作っている途中のものは、再生が同じかたまりを待って使う）
   */
  async warm(p: Project, from: number) {
    const id = ++this.warmSeq
    if (!this.anticipative || !this.ctx || this.playing || this.starting || this.chunks.limit <= 0) return
    const targets = p.tracks.filter((t) => anticipated(p, t))
    const end = Math.min(songEnd(p), from + AHEAD)
    const k0 = Math.floor(from / CHUNK)
    const total = Math.max(0, Math.ceil(end / CHUNK) - k0) * targets.length
    const job = this.gauge.warm(total ? targets.map((t) => t.name) : [])
    let done = 0
    try {
      for (let k = k0; k * CHUNK < end; k++) {
        for (const t of targets) {
          if (id !== this.warmSeq || this.playing || this.starting) return
          await this.makeChunk(p, t.id, k).catch(() => {})
          job.update(++done / total)
        }
      }
    } finally {
      job.end()
    }
  }

  /** 先読みの状態（デバッグ表示。off、対象のトラックの数、作れなかった理由） */
  private antInfo = '-'
  /** 先に作った音の置き場 */
  private readonly chunks = new ChunkCache()
  /** 置き場の上限（MB。設定。0 で取っておかない） */
  set chunkCacheMb(mb: number) {
    this.chunks.limit = mb * 1024 * 1024
    this.chunks.trim()
  }

  /** 先読みをやめる（編集したとき、先読みが間に合わなかったとき） */
  private release(id: string) {
    this.graph?.release(id)
    this.ant?.sigs.delete(id)
    this.ant?.next.delete(id)
    this.gauge.clear(id)
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
      // 再生位置からどこまでできているか
      for (const [id, k] of ant.next) this.gauge.setAhead(id, p.tracks.find((t) => t.id === id)?.name ?? id, (k * CHUNK - this.position()) / AHEAD)
    } catch {
      // 作れなかったら、次の周期でもう一度試す（続けて間に合わなければ release になる）
    } finally {
      ant.busy = false
    }
  }

  /** キーボードの音を鳴らす、離す。再生中は再生のグラフの音源で、していなければ、音源と FX の列だけのグラフで鳴らす */
  async monitorNote(p: Project, track: string, pitch: number, vel: number, on: boolean) {
    const send = (g: Graph) => (on ? g.noteOn(track, pitch, vel) : g.noteOff(track, pitch))
    // 押してすぐ離しても聞こえるように、離すのは鳴らしてから MONITOR_MIN 秒あとにする
    const id = `${track}:${pitch}`
    if (on) this.monitorOn.set(id, performance.now())
    else {
      const wait = MONITOR_MIN * 1000 - (performance.now() - (this.monitorOn.get(id) ?? 0))
      this.monitorOn.delete(id)
      if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    }
    // 再生のグラフに音源があればそれで鳴らす。先読みのトラックなど、なければモニターのグラフで鳴らす
    if (this.playing && this.graph?.hasInstrument(track)) return send(this.graph)
    const ctx = (this.ctx ??= new AudioContext())
    const q: Project = { ...p, blocks: [], midi: [] }
    // 音源と FX の列、音量、パンが変わったときだけ組み直す
    const key = JSON.stringify([p.tracks.map((t) => [t.id, t.instrument, t.fx, t.volume, t.pan, t.invert, t.mute, t.solo, t.parent]), p.master, p.tempo.bpm])
    if (!this.monitor || key !== this.monitorKey) {
      await Promise.all([startContext(ctx, 'player'), loadMixer(ctx), preloadFx(ctx, ...fxLists(q)), preloadInstruments(ctx, instrumentIds(q))])
      if (this.playing && this.graph?.hasInstrument(track)) return send(this.graph)
      this.monitor ??= new Graph(ctx, 0)
      this.monitor.sync(q, false)
      this.monitorKey = key
    }
    // 止まっている間に音声処理を止めていたら、鍵盤の音のために動かす
    if (ctx.state !== 'running') await startContext(ctx, 'player')
    // サンプラーのフォルマント保持: 押した高さの音を作り終えてから鳴らす（作っている間に離したら鳴らさない）
    if (on && wantSamplerPitch(q, track, pitch)) {
      await preparePitch(q)
      if (!this.monitorOn.has(id) || this.playing || !this.monitor) return
      this.monitor.sync(q, false)
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
    return this.ctx && this.playing ? this.from + Math.max(0, this.ctx.currentTime - this.startedAt - this.outputLatency() - this.fxLatency) : this.from
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
