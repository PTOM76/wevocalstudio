// 時間軸の描画（目盛り、トラックの区切り、波形ブロック、再生位置）
import type { Range } from 'wevocal-lib'
import type { Block, Project } from './project'

export const RULER = 24
/** マスタートラックの行の高さ（目盛りのすぐ下。REAPER と同じく一番上） */
export const MASTER = 96
/** トラックの行が始まる位置 */
export const TOP = RULER + MASTER
export const LANE = 96

export interface TimelineView {
  /** 左端の時刻（秒） */
  scroll: number
  /** 1 秒の幅（px） */
  pps: number
}

export interface TimelineColors {
  bg: string
  lane: string
  line: string
  text: string
  block: string
  blockSelected: string
  wave: string
  playhead: string
  /** マスタートラックの帯の色 */
  master: string
  /** 範囲選択の色 */
  range: string
}

/** 目盛りの間隔（秒）。文字が重ならない広さにする */
function tickStep(pps: number) {
  return [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300].find((s) => s * pps >= 70) ?? 600
}

function formatTime(t: number, step: number) {
  const m = Math.floor(t / 60)
  const s = t - m * 60
  return `${m}:${step < 1 ? s.toFixed(2).padStart(5, '0') : String(Math.round(s)).padStart(2, '0')}`
}

/** 波形ブロックの中に元の音の波形を描く（1 列ごとの最小と最大） */
function drawBlockWave(g: CanvasRenderingContext2D, b: Block, p: Project, x: number, y: number, w: number, h: number, width: number) {
  const source = p.sources.find((s) => s.id === b.source)
  if (!source) return
  const { clip } = source
  const data = clip.channels[0]
  const mid = y + h / 2
  const perPx = (b.length * clip.sampleRate) / w
  const amp = (h / 2) * Math.min(4, 10 ** (b.gain / 20))
  for (let px = Math.max(0, Math.floor(x)); px < Math.min(width, Math.ceil(x + w)); px++) {
    const a = Math.max(0, Math.floor(b.offset * clip.sampleRate + (px - x) * perPx))
    const e = Math.min(data.length, Math.floor(a + perPx) + 1)
    // 1 列で見るサンプルは多くても 256 個（長い音を縮めたときに重くならないように）
    const step = Math.max(1, Math.floor((e - a) / 256))
    let lo = 0
    let hi = 0
    for (let i = a; i < e; i += step) {
      const v = data[i]
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    g.fillRect(px, mid - hi * amp, 1, Math.max(1, (hi - lo) * amp))
  }
}

export function drawTimeline(canvas: HTMLCanvasElement, p: Project, view: TimelineView, selected: string | null, cursor: number, range: Range | null, c: TimelineColors) {
  const g = canvas.getContext('2d')!
  const w = canvas.width / devicePixelRatio
  const h = canvas.height / devicePixelRatio
  g.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)
  g.fillStyle = c.bg
  g.fillRect(0, 0, w, h)
  const tx = (t: number) => (t - view.scroll) * view.pps

  // 目盛り
  const step = tickStep(view.pps)
  g.font = '11px Roboto, sans-serif'
  g.textBaseline = 'middle'
  for (let t = Math.floor(view.scroll / step) * step; tx(t) < w; t += step) {
    const x = Math.round(tx(t)) + 0.5
    g.fillStyle = c.line
    g.fillRect(x, RULER - 6, 1, h)
    g.fillStyle = c.text
    g.fillText(formatTime(t, step), x + 3, RULER / 2)
  }

  // マスタートラックの帯（波形ブロックは置かない）
  g.fillStyle = c.master
  g.fillRect(0, RULER, w, MASTER)
  g.fillStyle = c.lane
  g.fillRect(0, TOP - 1, w, 1)

  // トラックと波形ブロック
  p.tracks.forEach((track, i) => {
    const y = TOP + i * LANE
    g.fillStyle = c.lane
    g.fillRect(0, y + LANE - 1, w, 1)
    for (const b of p.blocks) {
      if (b.track !== track.id) continue
      const x = tx(b.start)
      const bw = b.length * view.pps
      if (x > w || x + bw < 0) continue
      g.globalAlpha = b.mute ? 0.4 : 1
      g.fillStyle = b.id === selected ? c.blockSelected : c.block
      g.fillRect(x, y + 2, bw, LANE - 5)
      g.fillStyle = c.wave
      drawBlockWave(g, b, p, x, y + 16, bw, LANE - 20, w)
      // フェード
      g.strokeStyle = c.text
      g.beginPath()
      if (b.fadeIn > 0) {
        g.moveTo(x, y + LANE - 3)
        g.lineTo(x + b.fadeIn * view.pps, y + 2)
      }
      if (b.fadeOut > 0) {
        g.moveTo(x + bw - b.fadeOut * view.pps, y + 2)
        g.lineTo(x + bw, y + LANE - 3)
      }
      g.stroke()
      // 名前とピッチ、音量
      const name = p.sources.find((s) => s.id === b.source)?.name ?? ''
      const sign = (v: number) => (v > 0 ? `+${v}` : `${v}`)
      const info = [b.pitch ? `${sign(b.pitch)} st` : '', b.gain ? `${sign(b.gain)} dB` : ''].filter(Boolean).join('  ')
      g.save()
      g.beginPath()
      g.rect(x, y, bw, LANE)
      g.clip()
      g.fillStyle = c.text
      g.fillText(`${name}  ${info}`, x + 4, y + 9)
      g.restore()
      g.globalAlpha = 1
    }
  })

  // 範囲選択（全トラックにかかる。REAPER のタイムセレクション）
  if (range) {
    g.fillStyle = c.range
    g.fillRect(tx(range.start), 0, (range.end - range.start) * view.pps, h)
  }

  // 再生位置
  g.fillStyle = c.playhead
  g.fillRect(Math.round(tx(cursor)), 0, 1, h)
}
