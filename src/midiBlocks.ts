// MIDI ブロックの時間軸での描画と、押した所の判定（音符は小さな帯で見せる）。画面を知らない
import { ownAudible, trackHeight, type MidiBlock, type Project } from './project'
import { blockBeats, projectBeatMap } from './beats'
import { trackTop } from './drawTimeline'

/** 端をつかめる幅（px） */
const EDGE = 6

export type MidiDragKind = 'move' | 'right'

/** 表示する音の高さの範囲（音符のあるところ。最低でも 1 オクターブ） */
export function pitchSpan(b: MidiBlock): [number, number] {
  if (!b.notes.length) return [60, 72]
  let lo = Math.min(...b.notes.map((n) => n.pitch))
  let hi = Math.max(...b.notes.map((n) => n.pitch))
  if (hi - lo < 11) {
    const mid = Math.round((hi + lo) / 2)
    lo = mid - 6
    hi = mid + 5
  }
  return [lo, hi]
}

/** MIDI ブロックの外枠（時間軸の座標。トラックの行の中、波形ブロックと同じ高さ） */
export function midiRect(p: Project, b: MidiBlock, scroll: number, pps: number, vscroll: number) {
  const i = p.tracks.findIndex((t) => t.id === b.track)
  if (i < 0) return null
  return { x: (b.start - scroll) * pps, w: b.length * pps, y: trackTop(p, i) + 2 - vscroll, h: trackHeight(p.tracks[i]) - 5 }
}

/** 押した所の MIDI ブロック（x、y は時間軸の座標で、y は縦のスクロールを足した内容の座標）。端なら長さを変える */
export function hitMidi(p: Project, x: number, y: number, toTime: (x: number) => number, pps: number): { block: MidiBlock; kind: MidiDragKind } | null {
  const i = p.tracks.findIndex((_, k) => y >= trackTop(p, k) && y < trackTop(p, k) + trackHeight(p.tracks[k]))
  const track = p.tracks[i]
  if (!track) return null
  const t = toTime(x)
  const block = (p.midi ?? []).findLast((b) => b.track === track.id && t >= b.start - EDGE / pps && t < b.start + b.length + EDGE / pps)
  if (!block) return null
  return { block, kind: (block.start + block.length - t) * pps < EDGE ? 'right' : 'move' }
}

export interface MidiColors {
  block: string
  blockSelected: string
  note: string
  text: string
}

/** 1 トラックぶんの MIDI ブロックを描く */
export function drawMidiBlocks(g: CanvasRenderingContext2D, p: Project, trackId: string, scroll: number, pps: number, vscroll: number, width: number, selected: string[], c: MidiColors) {
  const track = p.tracks.find((t) => t.id === trackId)
  if (!track) return
  const map = projectBeatMap(p)
  for (const b of p.midi ?? []) {
    if (b.track !== trackId) continue
    const r = midiRect(p, b, scroll, pps, vscroll)
    if (!r || r.x > width || r.x + r.w < 0) continue
    g.save()
    g.globalAlpha = b.mute || !ownAudible(p, track) ? 0.35 : 1
    g.fillStyle = selected.includes(b.id) ? c.blockSelected : c.block
    g.fillRect(r.x, r.y, r.w, r.h)
    g.beginPath()
    g.rect(r.x, r.y, r.w, r.h)
    g.clip()
    g.fillStyle = c.text
    g.fillText(b.name?.trim() || b.defaultName || 'MIDI', r.x + 4, r.y + 9)
    const [lo, hi] = pitchSpan(b)
    const top = r.y + (r.h >= 40 ? 14 : 3)
    const h = r.h - (top - r.y) - 3
    const nh = Math.max(2, Math.min(8, h / (hi - lo + 1)))
    g.fillStyle = c.note
    // 音符は拍なので、秒に直して描く
    const b0 = map.toBeat(b.start)
    const len = blockBeats(map, b)
    for (const n of b.notes) {
      const y = top + (1 - (n.pitch - lo) / (hi - lo + 1)) * (h - nh)
      const t0 = map.toSec(b0 + n.t) - b.start
      const t1 = map.toSec(b0 + n.t + Math.min(n.dur, len - n.t)) - b.start
      g.fillRect(r.x + t0 * pps, y, Math.max(2, (t1 - t0) * pps), nh)
    }
    g.restore()
  }
}
