// 再生と書き出し。波形ブロックごとに元の音（ピッチを変えたものはキャッシュ）から Web Audio のノードを組む（再生は AudioContext、書き出しは OfflineAudioContext）
import { buildEqChain, isFlatEq, type Clip } from 'wevocal-lib'
import { clipFor, preparePitch } from './dsp/pitch'
import { audible, dbToGain, projectEnd, type Project } from './project'

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

/** from 秒の位置から鳴らすノードを組み、ctx の時刻 when に始める。止めるためにノードの一覧を返す */
function schedule(ctx: BaseAudioContext, p: Project, from: number, when: number) {
  const nodes: AudioScheduledSourceNode[] = []
  // トラック → マスター → 出力
  const master = ctx.createGain()
  master.gain.value = p.master.mute ? 0 : dbToGain(p.master.volume)
  const masterPan = ctx.createStereoPanner()
  masterPan.pan.value = p.master.pan
  // 出口。鳴らし直すときに古い音を消し、新しい音を入れる（つなぎ目でぶつっと鳴らないように）
  const out = ctx.createGain()
  master.connect(masterPan).connect(out).connect(ctx.destination)
  for (const track of p.tracks) {
    if (!audible(p, track)) continue
    const gain = ctx.createGain()
    gain.gain.value = dbToGain(track.volume) * (track.invert ? -1 : 1)
    const pan = ctx.createStereoPanner()
    pan.pan.value = track.pan
    // トラック: 音量 → EQ → パン → マスター（EQ は WeVocalSynth と同じ wevocal-lib のもの）
    if (track.eq && !isFlatEq(track.eq)) {
      const eq = buildEqChain(ctx, track.eq)
      gain.connect(eq.input)
      eq.output.connect(pan)
    } else gain.connect(pan)
    pan.connect(master)
    for (const b of p.blocks) {
      const source = p.sources.find((s) => s.id === b.source)
      if (b.track !== track.id || b.mute || !source || b.start + b.length <= from) continue
      const node = ctx.createBufferSource()
      // 作った音（できるまでは前の音）。どちらもなければ元の音
      const made = clipFor(b, source)
      node.buffer = bufferOf(ctx, made?.clip ?? source.clip)
      const g = ctx.createGain()
      const level = dbToGain(b.gain)
      // フェード（時間軸の時刻で書く）
      const t0 = when + b.start - from
      const t1 = t0 + b.length
      g.gain.setValueAtTime(b.fadeIn > 0 ? 0 : level, Math.max(when, t0))
      if (b.fadeIn > 0) g.gain.linearRampToValueAtTime(level, t0 + b.fadeIn)
      if (b.fadeOut > 0) {
        g.gain.setValueAtTime(level, t1 - b.fadeOut)
        g.gain.linearRampToValueAtTime(0, t1)
      }
      node.connect(g).connect(gain)
      const skip = Math.max(0, from - b.start)
      if (made) {
        // 作った音は元の音の made.from 秒からで、速度の分だけ伸び縮みしている
        node.start(Math.max(when, t0), (b.offset - made.from) / b.rate + skip, b.length - skip)
      } else {
        // できるまでは元の音を速度の分だけ速く鳴らす（ピッチも変わる仮の音）
        node.playbackRate.value = b.rate
        node.start(Math.max(when, t0), b.offset + skip * b.rate, (b.length - skip) * b.rate)
      }
      nodes.push(node)
    }
  }
  return { nodes, out }
}

/** 鳴らし直すときのつなぎ（秒） */
const FADE = 0.02

/** 再生。位置は AudioContext の時計から求める */
export class Player {
  private ctx: AudioContext | null = null
  private nodes: AudioScheduledSourceNode[] = []
  private out: GainNode | null = null
  private startedAt = 0
  private from = 0
  playing = false

  play(p: Project, from: number) {
    const again = this.playing
    this.stop()
    this.ctx ??= new AudioContext()
    void this.ctx.resume()
    this.from = from
    // 鳴らし直すときは待たずに続ける（前の音は stop で消えていく）
    this.startedAt = this.ctx.currentTime + (again ? 0.01 : 0.05)
    const r = schedule(this.ctx, p, from, this.startedAt)
    this.nodes = r.nodes
    this.out = r.out
    if (again) {
      r.out.gain.setValueAtTime(0, this.startedAt)
      r.out.gain.linearRampToValueAtTime(1, this.startedAt + FADE)
    }
    this.playing = true
  }

  stop() {
    // 少しだけかけて消してから止める
    const t = this.ctx?.currentTime ?? 0
    this.out?.gain.setTargetAtTime(0, t, FADE / 3)
    for (const n of this.nodes) {
      try {
        n.stop(t + FADE * 2)
      } catch {
        // 始まる前のノード
      }
    }
    this.nodes = []
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
  schedule(ctx, p, 0, 0)
  const out = await ctx.startRendering()
  return { sampleRate, channels: [out.getChannelData(0), out.getChannelData(1)] }
}
