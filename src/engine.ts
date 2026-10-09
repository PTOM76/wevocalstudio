// 再生と書き出し。波形ブロックごとに元の音から Web Audio のノードを組む（再生は AudioContext、書き出しは OfflineAudioContext）
import { encodeWav, type Clip } from 'wevocal-lib'
import { audible, dbToGain, projectEnd, type Project, type Source } from './project'

const buffers = new WeakMap<Clip, AudioBuffer>()

function bufferOf(ctx: BaseAudioContext, s: Source) {
  let buf = buffers.get(s.clip)
  if (!buf || buf.sampleRate !== s.clip.sampleRate) {
    const { channels, sampleRate } = s.clip
    buf = ctx.createBuffer(channels.length, channels[0].length, sampleRate)
    channels.forEach((c, i) => buf!.copyToChannel(c as Float32Array<ArrayBuffer>, i))
    buffers.set(s.clip, buf)
  }
  return buf
}

/** from 秒の位置から鳴らすノードを組み、ctx の時刻 when に始める。止めるためにノードの一覧を返す */
function schedule(ctx: BaseAudioContext, p: Project, from: number, when: number) {
  const nodes: AudioScheduledSourceNode[] = []
  for (const track of p.tracks) {
    if (!audible(p, track)) continue
    const gain = ctx.createGain()
    gain.gain.value = dbToGain(track.volume)
    const pan = ctx.createStereoPanner()
    pan.pan.value = track.pan
    gain.connect(pan).connect(ctx.destination)
    for (const b of p.blocks) {
      const source = p.sources.find((s) => s.id === b.source)
      if (b.track !== track.id || b.mute || !source || b.start + b.length <= from) continue
      const node = ctx.createBufferSource()
      node.buffer = bufferOf(ctx, source)
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
      node.start(Math.max(when, t0), b.offset + skip, b.length - skip)
      nodes.push(node)
    }
  }
  return nodes
}

/** 再生。位置は AudioContext の時計から求める */
export class Player {
  private ctx: AudioContext | null = null
  private nodes: AudioScheduledSourceNode[] = []
  private startedAt = 0
  private from = 0
  playing = false

  play(p: Project, from: number) {
    this.stop()
    this.ctx ??= new AudioContext()
    void this.ctx.resume()
    this.from = from
    this.startedAt = this.ctx.currentTime + 0.05
    this.nodes = schedule(this.ctx, p, from, this.startedAt)
    this.playing = true
  }

  stop() {
    for (const n of this.nodes) {
      try {
        n.stop()
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

/** 全トラックを混ぜて WAV にする */
export async function renderWav(p: Project, sampleRate = 48000) {
  const length = Math.max(1, Math.ceil(projectEnd(p) * sampleRate))
  const ctx = new OfflineAudioContext(2, length, sampleRate)
  schedule(ctx, p, 0, 0)
  const out = await ctx.startRendering()
  return encodeWav({ sampleRate, channels: [out.getChannelData(0), out.getChannelData(1)] })
}
