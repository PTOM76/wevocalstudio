// 再生と書き出し。波形ブロックごとに元の音（ピッチを変えたものはキャッシュ）から Web Audio のノードを組む（再生は AudioContext、書き出しは OfflineAudioContext）。
// 再生中に変えたときは、変わった波形ブロックだけを差し替え、トラックとマスターの音量などは値だけを変える（全部を鳴らし直すと一瞬止まるため）
import { createLiveEq, flatEq, updateLiveEq, type Clip, type LiveEq } from 'wevocal-lib'
import { clipFor, preparePitch } from './dsp/pitch'
import { audible, dbToGain, projectEnd, type Block, type Project, type Track } from './project'

const buffers = new WeakMap<Clip, AudioBuffer>()

function bufferOf(ctx: BaseAudioContext, clip: Clip) {
  let buf = buffers.get(clip)
  if (!buf) {
    const { channels, sampleRate } = clip
    buf = ctx.createBuffer(channels.length, channels[0].length, sampleRate)
    channels.forEach((c, i) => buf!.copyToChannel(c as Float32Array<ArrayBuffer>, i))
    buffers.set(clip, buf)
  }
  return buf
}

/** 鳴らし直すとき、差し替えるときのつなぎ（秒） */
const FADE = 0.02

/** Clip ごとの番号（波形ブロックの音が変わったかを比べるため） */
const clipIds = new WeakMap<Clip, number>()
let nextClipId = 1
const clipId = (c: Clip) => clipIds.get(c) ?? (clipIds.set(c, nextClipId), nextClipId++)

interface TrackNodes {
  input: GainNode
  pan: StereoPannerNode
  /** 鳴らしたまま値を変えられる EQ（WeVocalSynth の再生と同じ wevocal-lib のもの） */
  eq: LiveEq
}
interface BlockNodes {
  node: AudioBufferSourceNode
  gain: GainNode
  sig: string
}

/** 組んだノード（トラックごとの入口と、波形ブロックごとの音源） */
class Graph {
  readonly out: GainNode
  private readonly master: GainNode
  private readonly masterPan: StereoPannerNode
  private readonly tracks = new Map<string, TrackNodes>()
  private readonly blocks = new Map<string, BlockNodes>()
  private readonly ctx: BaseAudioContext
  /** 時間軸の 0 秒が ctx の何秒か */
  private readonly zero: number

  constructor(ctx: BaseAudioContext, zero: number) {
    this.ctx = ctx
    this.zero = zero
    this.master = ctx.createGain()
    this.masterPan = ctx.createStereoPanner()
    this.out = ctx.createGain()
    this.master.connect(this.masterPan).connect(this.out).connect(ctx.destination)
  }

  private buildTrack(t: Track): TrackNodes {
    const input = this.ctx.createGain()
    const pan = this.ctx.createStereoPanner()
    // トラック: 音量 → EQ → パン → マスター
    const eq = createLiveEq(this.ctx, t.eq ?? flatEq())
    input.connect(eq.input)
    eq.output.connect(pan)
    pan.connect(this.master)
    return { input, pan, eq }
  }

  /** 波形ブロックを比べる文字（変わったら差し替える） */
  private static sig(b: Block, clip: Clip, from: number) {
    return `${b.track}|${b.start}|${b.offset}|${b.length}|${b.rate}|${b.gain}|${b.fadeIn}|${b.fadeOut}|${clipId(clip)}|${from}`
  }

  /** from 秒より後ろの波形ブロックを鳴らす。変わっていないものはそのまま。差し替えるものは FADE でつなぐ */
  sync(p: Project, from: number, now: number, smooth: boolean) {
    // マスターとトラックの値（鳴らしたまま変える）
    const at = this.ctx.currentTime
    this.master.gain.setTargetAtTime(p.master.mute ? 0 : dbToGain(p.master.volume), at, 0.01)
    this.masterPan.pan.setTargetAtTime(p.master.pan, at, 0.01)
    for (const t of p.tracks) {
      let n = this.tracks.get(t.id)
      if (!n) {
        n = this.buildTrack(t)
        this.tracks.set(t.id, n)
      } else updateLiveEq(n.eq, t.eq ?? flatEq())
      // ミュートとソロは音量 0 にする（ノードは残す）
      n.input.gain.setTargetAtTime(audible(p, t) ? dbToGain(t.volume) * (t.invert ? -1 : 1) : 0, at, 0.01)
      n.pan.pan.setTargetAtTime(t.pan, at, 0.01)
    }
    for (const [id, n] of this.tracks) {
      if (p.tracks.some((t) => t.id === id)) continue
      n.input.disconnect()
      n.pan.disconnect()
      this.tracks.delete(id)
    }

    const live = new Set<string>()
    for (const b of p.blocks) {
      const source = p.sources.find((s) => s.id === b.source)
      const track = this.tracks.get(b.track)
      if (b.mute || !source || !track || b.start + b.length <= from) continue
      // 作った音（変えていなければ元の音）。作り直している間は鳴らさない
      const made = clipFor(b, source)
      if (!made) continue
      const clip = made.clip
      const sig = Graph.sig(b, clip, made.from)
      live.add(b.id)
      const old = this.blocks.get(b.id)
      if (old?.sig === sig) continue
      if (old) this.stopBlock(old)
      this.blocks.set(b.id, { ...this.startBlock(b, clip, made, track.input, from, now, smooth && !!old), sig })
    }
    for (const [id, n] of this.blocks) {
      if (live.has(id)) continue
      this.stopBlock(n)
      this.blocks.delete(id)
    }
  }

  private startBlock(b: Block, clip: Clip, made: { from: number } | null, dest: AudioNode, from: number, now: number, fadeIn: boolean): Omit<BlockNodes, 'sig'> {
    const ctx = this.ctx
    const node = ctx.createBufferSource()
    node.buffer = bufferOf(ctx, clip)
    const g = ctx.createGain()
    const level = dbToGain(b.gain)
    // 時間軸の時刻で書く。今より前に始まっていれば、今から途中を鳴らす
    const t0 = this.zero + b.start
    const t1 = t0 + b.length
    const begin = Math.max(now, t0)
    const skip = Math.max(0, from - b.start)
    // 差し替えのときは小さく始めて FADE で上げる（ぶつっと鳴らないように）
    if (fadeIn && t0 < now) {
      g.gain.setValueAtTime(0, begin)
      g.gain.linearRampToValueAtTime(level, begin + FADE)
    } else g.gain.setValueAtTime(b.fadeIn > 0 && t0 >= now ? 0 : level, begin)
    if (b.fadeIn > 0 && t0 >= now) g.gain.linearRampToValueAtTime(level, t0 + b.fadeIn)
    if (b.fadeOut > 0) {
      g.gain.setValueAtTime(level, Math.max(begin + FADE, t1 - b.fadeOut))
      g.gain.linearRampToValueAtTime(0, t1)
    }
    node.connect(g).connect(dest)
    if (made) {
      // 作った音は元の音の made.from 秒からで、速度の分だけ伸び縮みしている
      node.start(begin, (b.offset - made.from) / b.rate + skip, Math.max(0, b.length - skip))
    } else {
      // できるまでは元の音を速度の分だけ速く鳴らす（ピッチも変わる仮の音）
      node.playbackRate.value = b.rate
      node.start(begin, b.offset + skip * b.rate, Math.max(0, (b.length - skip) * b.rate))
    }
    return { node, gain: g }
  }

  private stopBlock(n: BlockNodes) {
    const t = this.ctx.currentTime
    n.gain.gain.cancelScheduledValues(t)
    n.gain.gain.setTargetAtTime(0, t, FADE / 3)
    try {
      n.node.stop(t + FADE * 2)
    } catch {
      // 始まる前のノード
    }
  }

  /** 全部を消して止める */
  stopAll() {
    const t = this.ctx.currentTime
    this.out.gain.setTargetAtTime(0, t, FADE / 3)
    for (const n of this.blocks.values()) {
      try {
        n.node.stop(t + FADE * 2)
      } catch {
        // 始まる前のノード
      }
    }
    this.blocks.clear()
  }

}

/** 再生。位置は AudioContext の時計から求める */
export class Player {
  private ctx: AudioContext | null = null
  private graph: Graph | null = null
  private startedAt = 0
  private from = 0
  playing = false

  /** from 秒から鳴らす（鳴っていれば、古い音を消して新しく始める） */
  play(p: Project, from: number) {
    const again = this.playing
    this.stop()
    this.ctx ??= new AudioContext()
    void this.ctx.resume()
    this.from = from
    // 鳴らし直すときは待たずに続ける（前の音は stop で消えていく）
    this.startedAt = this.ctx.currentTime + (again ? 0.01 : 0.05)
    this.graph = new Graph(this.ctx, this.startedAt - from)
    if (again) {
      this.graph.out.gain.setValueAtTime(0, this.startedAt)
      this.graph.out.gain.linearRampToValueAtTime(1, this.startedAt + FADE)
    }
    this.graph.sync(p, from, this.startedAt, false)
    this.playing = true
  }

  /** 再生中に変えたものだけを差し替える（位置はそのまま） */
  update(p: Project) {
    if (!this.playing || !this.graph || !this.ctx) return
    const now = this.ctx.currentTime + 0.01
    this.graph.sync(p, this.position(), now, true)
  }

  stop() {
    this.graph?.stopAll()
    this.graph = null
    this.playing = false
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
  const length = Math.max(1, Math.ceil(Math.max(projectEnd(p), until) * sampleRate))
  const ctx = new OfflineAudioContext(2, length, sampleRate)
  new Graph(ctx, 0).sync(p, 0, 0, false)
  const out = await ctx.startRendering()
  return { sampleRate, channels: [out.getChannelData(0), out.getChannelData(1)] }
}
