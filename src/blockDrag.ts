// 波形ブロックのドラッグ（移動、端で長さを変える、角でフェード）の計算。画面を知らない
import { LANE, TOP, tickStep } from './drawTimeline'
import { layoutRows } from './overlap'
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
  /** 一緒に動かす、選んでいるほかの波形ブロック（つまんだときのもの） */
  others: Block[]
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
  // 重なって段に分けたものは、押した段のものだけを見る
  const slots = layoutRows(p.blocks.filter((b) => b.track === track.id))
  const inLane = y - (TOP + i * LANE)
  const inRow = (b: Block) => {
    const s = slots.get(b.id) ?? { row: 0, rows: 1 }
    return Math.floor((inLane / LANE) * s.rows) === s.row
  }
  const block = p.blocks.findLast((b) => b.track === track.id && inRow(b) && t >= b.start - EDGE / pps && t < b.start + b.length + EDGE / pps)
  if (!block) return null
  const slot = slots.get(block.id) ?? { row: 0, rows: 1 }
  const left = (t - block.start) * pps
  const right = (block.start + block.length - t) * pps
  const top = inLane - (slot.row * LANE) / slot.rows < CORNER
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

/** 吸い付ける距離（px） */
const SNAP_PX = 8

/** 吸い付ける先（目盛りの線は近くのものだけ作る）。exclude の波形ブロックの端は除く */
export function snapTargets(p: Project, cursor: number, exclude: string[]) {
  const edges = [0, cursor]
  for (const b of p.blocks) if (!exclude.includes(b.id)) edges.push(b.start, b.start + b.length)
  return edges
}

/** 時刻 t を、近くの吸い付ける先（目盛りの線、edges）に寄せる。なければ null */
export function snapTime(t: number, edges: number[], pps: number): number | null {
  const tol = SNAP_PX / pps
  const step = tickStep(pps)
  const grid = Math.round(t / step) * step
  let best: number | null = Math.abs(grid - t) <= tol ? grid : null
  for (const e of edges) if (Math.abs(e - t) <= tol && (best === null || Math.abs(e - t) < Math.abs(best - t))) best = e
  return best
}

/** ドラッグで動かした時間 dt を吸い付ける。移動は頭か終わりの近い方、端はその端を寄せる */
export function snapDelta(d: Drag, dt: number, edges: number[], pps: number): number {
  const b = d.block
  const points = d.kind === 'move' ? [b.start, b.start + b.length] : d.kind === 'left' ? [b.start] : d.kind === 'right' ? [b.start + b.length] : []
  let best: number | null = null
  for (const at of points) {
    const s = snapTime(at + dt, edges, pps)
    if (s !== null && (best === null || Math.abs(s - at - dt) < Math.abs(best - dt))) best = s - at
  }
  return best ?? dt
}
