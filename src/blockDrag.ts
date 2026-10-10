// 波形ブロックのドラッグ（移動、端で長さを変える、角でフェード）の計算。画面を知らない
import { LANE, TOP } from './drawTimeline'
import { snapGrid, type GridDivision, type GridMode } from './grid'
import { layoutRows } from './overlap'
import { ENV_MAX, ENV_MIN, RATE_MAX, RATE_MIN, type Block, type Marker, type Project, type Tempo } from './project'

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
  /** Ctrl を押して始めた（動かせば複製、動かさずに離せば選択の足し引き） */
  copy?: { wasSelected: boolean; done: boolean }
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

/** エンベロープの線を描く高さの割合（dB → 0〜1。0 dB が 3/4 の高さ） */
export function envY(db: number) {
  return db >= 0 ? 0.25 - (db / ENV_MAX) * 0.25 : 0.25 + (db / ENV_MIN) * 0.75
}
export function envDb(frac: number) {
  return frac <= 0.25 ? ((0.25 - frac) / 0.25) * ENV_MAX : ((frac - 0.25) / 0.75) * ENV_MIN
}

/** 押した所の近くにあるエンベロープの点（番号）。なければ -1 */
export function hitEnvPoint(b: Block, x: number, y: number, blockX: number, top: number, h: number, pps: number) {
  return (b.envelope ?? []).findIndex((pt) => Math.hypot(blockX + pt.t * pps - x, top + envY(pt.db) * h - y) < 7)
}

/** Alt を押して本体をドラッグしたとき: 位置と長さはそのままで、中の音だけをずらす。元の音の端より外へはずらさない */
export function slipPatch(p: Project, b: Block, dt: number): Partial<Block> {
  const total = p.sources.find((s) => s.id === b.source)?.duration ?? b.offset + b.length * b.rate
  // 右へドラッグすると音が右へずれる（元の音の前の所が見えてくる）
  return { offset: Math.max(0, Math.min(total - b.length * b.rate, b.offset - dt * b.rate)) }
}

/** ドラッグで変える値。dt は動かした時間（秒）、di は動かしたトラックの数。stretch なら端で速度ごと伸び縮みする */
export function dragPatch(p: Project, d: Drag, dt: number, di: number, stretch = false): Partial<Block> {
  const b = d.block
  const source = p.sources.find((s) => s.id === b.source)
  // 元の音の長さ（秒）
  const total = source?.duration ?? b.offset + (b.start + b.length) * b.rate
  if (stretch && (d.kind === 'left' || d.kind === 'right')) {
    // 使う元の音の範囲はそのままで、長さと速度を変える
    const span = b.length * b.rate
    const length = Math.max(span / RATE_MAX, Math.min(span / RATE_MIN, b.length + (d.kind === 'right' ? dt : -dt)))
    const start = d.kind === 'left' ? Math.max(0, b.start + b.length - length) : b.start
    return { start, length, rate: span / length, fadeIn: Math.min(b.fadeIn, length), fadeOut: Math.min(b.fadeOut, length) }
  }
  switch (d.kind) {
    case 'move': {
      const i = Math.min(p.tracks.length - 1, Math.max(0, d.trackIndex + di))
      return { start: Math.max(0, b.start + dt), track: p.tracks[i].id }
    }
    case 'left': {
      // 元の音の頭より前と、右端を越えては伸ばさない
      const move = Math.max(-b.offset / b.rate, -b.start, Math.min(dt, b.length - MIN_LENGTH))
      const length = b.length - move
      return { start: b.start + move, offset: b.offset + move * b.rate, length, fadeIn: Math.min(b.fadeIn, length), fadeOut: Math.min(b.fadeOut, length) }
    }
    case 'right': {
      const length = Math.max(MIN_LENGTH, Math.min((total - b.offset) / b.rate, b.length + dt))
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
/** 寄せる線の決め方（線の取り方、テンポ、拡大の度合い） */
export interface SnapGrid {
  mode: GridMode
  markers: readonly Marker[]
  division: GridDivision
  tempo: Tempo
  pps: number
}

export function snapTime(t: number, edges: number[], s: SnapGrid): number | null {
  const { pps } = s
  const tol = SNAP_PX / pps
  const { origin, step } = snapGrid(s.mode, s.tempo, pps, s.division, s.markers, t)
  const grid = origin + Math.round((t - origin) / step) * step
  let best: number | null = Math.abs(grid - t) <= tol ? grid : null
  for (const e of edges) if (Math.abs(e - t) <= tol && (best === null || Math.abs(e - t) < Math.abs(best - t))) best = e
  return best
}

/** ドラッグで動かした時間 dt を吸い付ける。移動は頭か終わりの近い方、端はその端を寄せる */
export function snapDelta(d: Drag, dt: number, edges: number[], grid: SnapGrid): number {
  const b = d.block
  const points = d.kind === 'move' ? [b.start, b.start + b.length] : d.kind === 'left' ? [b.start] : d.kind === 'right' ? [b.start + b.length] : []
  let best: number | null = null
  for (const at of points) {
    const s = snapTime(at + dt, edges, grid)
    if (s !== null && (best === null || Math.abs(s - at - dt) < Math.abs(best - dt))) best = s - at
  }
  return best ?? dt
}
