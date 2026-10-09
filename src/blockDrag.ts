// 波形ブロックのドラッグ（移動、端で長さを変える、角でフェード）の計算。画面を知らない
import { LANE, TOP } from './drawTimeline'
import type { Block, Project } from './project'

/** つまむ所。move は本体、left / right は端、fadeIn / fadeOut は上の角 */
export type DragKind = 'move' | 'left' | 'right' | 'fadeIn' | 'fadeOut'

/** 端と角をつまめる幅（px） */
const EDGE = 6
/** 角（フェード）をつまめる上の高さ（px） */
const CORNER = 14
/** 短くしすぎないための最小の長さ（秒） */
const MIN_LENGTH = 0.01

export interface Drag {
  kind: DragKind
  /** つまんだときの波形ブロック */
  block: Block
  x: number
  y: number
  trackIndex: number
  /** 履歴をまとめるための名前（ドラッグごとに変える） */
  merge: string
}

/** (x, y) にある波形ブロックと、つまむ所。後に置いたものが上に描かれるので、後ろから探す */
export function hitBlock(p: Project, x: number, y: number, toTime: (x: number) => number, pps: number): { block: Block; kind: DragKind } | null {
  const i = Math.floor((y - TOP) / LANE)
  const track = p.tracks[i]
  if (!track) return null
  const t = toTime(x)
  const block = p.blocks.findLast((b) => b.track === track.id && t >= b.start - EDGE / pps && t < b.start + b.length + EDGE / pps)
  if (!block) return null
  const left = (t - block.start) * pps
  const right = (block.start + block.length - t) * pps
  const top = y - (TOP + i * LANE) < CORNER
  // 上の角はフェード（フェードの終わりの位置もつまめる）
  if (top && left < EDGE + block.fadeIn * pps && left < (block.length * pps) / 2) return { block, kind: 'fadeIn' }
  if (top && right < EDGE + block.fadeOut * pps) return { block, kind: 'fadeOut' }
  if (left < EDGE) return { block, kind: 'left' }
  if (right < EDGE) return { block, kind: 'right' }
  return { block, kind: 'move' }
}

/** カーソルの形 */
export const CURSOR: Record<DragKind, string> = { move: 'grab', left: 'ew-resize', right: 'ew-resize', fadeIn: 'nesw-resize', fadeOut: 'nwse-resize' }

/** ドラッグで変える値。dt は動かした時間（秒）、di は動かしたトラックの数 */
export function dragPatch(p: Project, d: Drag, dt: number, di: number): Partial<Block> {
  const b = d.block
  const source = p.sources.find((s) => s.id === b.source)
  const total = source?.duration ?? b.start + b.length
  switch (d.kind) {
    case 'move': {
      const i = Math.min(p.tracks.length - 1, Math.max(0, d.trackIndex + di))
      return { start: Math.max(0, b.start + dt), track: p.tracks[i].id }
    }
    case 'left': {
      // 元の音の頭より前と、右端を越えては伸ばさない
      const move = Math.max(-b.offset, -b.start, Math.min(dt, b.length - MIN_LENGTH))
      const length = b.length - move
      return { start: b.start + move, offset: b.offset + move, length, fadeIn: Math.min(b.fadeIn, length), fadeOut: Math.min(b.fadeOut, length) }
    }
    case 'right': {
      const length = Math.max(MIN_LENGTH, Math.min(total - b.offset, b.length + dt))
      return { length, fadeIn: Math.min(b.fadeIn, length), fadeOut: Math.min(b.fadeOut, length) }
    }
    case 'fadeIn':
      return { fadeIn: Math.max(0, Math.min(b.length - b.fadeOut, b.fadeIn + dt)) }
    case 'fadeOut':
      return { fadeOut: Math.max(0, Math.min(b.length - b.fadeIn, b.fadeOut - dt)) }
  }
}
