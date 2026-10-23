// 時間軸のドラッグで、プロジェクトがどう変わるかの計算（波形ブロックの移動、長さ、MIDI ブロック、オートメーションとエンベロープの点、枠と Shift での選択）。状態に触れない純粋な関数
import type { AutoPoint } from 'wevocal-lib'
import { fracToParam } from 'wevocal-lib'
import type { Drag } from '../blockDrag'
import { dragPatch, slipPatch, snapDelta, snapTargets } from '../blockDrag'
import type { LaneGeom } from '../autoLane'
import { blockBeats, projectBeatMap } from '../beats'
import type { EnvSpec } from '../envelopes'
import { trimLeft, type MidiDragKind } from '../midiBlocks'
import type { Block, MidiBlock, Project } from '../project'

type Snapping = Parameters<typeof snapDelta>[3]

/**
 * ドラッグ中の波形ブロックの、変える値（id → 値）。raw はつかんだ所からの動き（秒。表示が流れた分も含む）、di はトラックの行の動き。
 * Alt で本体をつかんだら中の音だけをずらし、端を Alt でドラッグすると速度ごと伸び縮みする。まとめて動かすときは、一番前のものが 0 より前に出ない所、トラックの外に出ない所で止める
 */
export function blockDragPatches(p: Project, d: Drag, raw: number, di: number, o: { altKey: boolean; shiftKey: boolean; snap: boolean; cursor: number; snapping: Snapping }): Record<string, Partial<Block>> {
  const all = [d.block, ...d.others]
  if (o.altKey && d.kind === 'move') return Object.fromEntries(all.map((b) => [b.id, slipPatch(p, b, raw)]))
  // Shift を押している間は吸い付けない
  let dt = o.snap && !o.shiftKey ? snapDelta(d, raw, snapTargets(p, o.cursor, [d.block.id, ...d.others.map((b) => b.id)]), o.snapping) : raw
  if (d.kind === 'left' || d.kind === 'right') return Object.fromEntries(all.map((b) => [b.id, dragPatch(p, { ...d, block: b, others: [] }, dt, 0, o.altKey)]))
  if (!d.others.length) return { [d.block.id]: dragPatch(p, d, dt, di, o.altKey) }
  dt = Math.max(dt, -Math.min(...all.map((b) => b.start)))
  const rows = all.map((b) => p.tracks.findIndex((t) => t.id === b.track))
  const shift = Math.max(-Math.min(...rows), Math.min(p.tracks.length - 1 - Math.max(...rows), di))
  return Object.fromEntries(all.map((b, i) => [b.id, { start: b.start + dt, track: p.tracks[rows[i] + shift].id }]))
}

/** ドラッグ中の MIDI ブロックの、変える値。grid は端の位置（画面の x）を拍と秒に合わせる、track は縦の位置のトラックの id */
export function midiDragPatch(p: Project, md: { kind: MidiDragKind; grabPx: number; orig: MidiBlock; alt: boolean }, b: MidiBlock, x: number, track: string | undefined, grid: (x: number) => number): Partial<MidiBlock> {
  if (md.kind === 'move') return { start: Math.max(0, grid(x - md.grabPx)), ...(track ? { track } : {}) }
  // 左端: 左端より前の音符を切る（元のブロックから計算するので、ドラッグの途中で戻せる）
  if (md.kind === 'left') return trimLeft(md.orig, grid(x), projectBeatMap(p))
  // Alt を押して右端をドラッグすると、今の中身を 1 回分のループにして、長さを変える（繰り返しで伸ばす）
  const loop = md.alt && !md.orig.loop ? { loop: blockBeats(projectBeatMap(p), md.orig) } : {}
  return { length: Math.max(0.05, grid(x) - b.start), ...loop }
}

/** オートメーションの点 index を (t, v) に動かした点の並び。前後の点は越えない */
export function movedAutoPoints(lane: Pick<LaneGeom, 'points' | 'def' | 'top' | 'h'>, index: number, y: number, gridTime: number): AutoPoint[] | null {
  if (!lane.points[index]) return null
  const pts = [...lane.points]
  const lo = pts[index - 1]?.t ?? 0
  const hi = pts[index + 1]?.t ?? Infinity
  pts[index] = { t: Math.max(lo, Math.min(hi, gridTime)), v: fracToParam(lane.def, (y - lane.top) / lane.h) }
  return pts
}

/** エンベロープの点 index を動かした点の並び（x、y は画面の座標、blockX と top と h は波形ブロックの画面の位置）。前後の点は越えない */
export function movedEnvPoints(spec: EnvSpec, b: Block, index: number, x: number, y: number, g: { x: number; top: number; h: number }, pps: number, range: number): ReturnType<EnvSpec['points']> | null {
  const env = spec.points(b)
  if (!env[index]) return null
  const lo = env[index - 1]?.t ?? 0
  const hi = env[index + 1]?.t ?? b.length
  env[index] = { ...env[index], t: Math.max(lo, Math.min(hi, (x - g.x) / pps)), v: spec.value((y - g.top) / g.h, range) }
  return env
}

/** 右ドラッグの枠 (x0, y0)〜(x1, y1)（時間軸の座標）にかかる波形ブロックの id。toTime は x を秒に、slotAt は y をトラックの並びの番号にする */
export function marqueeIds(p: Project, x0: number, y0: number, x1: number, y1: number, toTime: (x: number) => number, slotAt: (y: number) => number): string[] {
  const ta = toTime(Math.min(x0, x1))
  const tb = toTime(Math.max(x0, x1))
  const ra = slotAt(Math.min(y0, y1))
  const rb = slotAt(Math.max(y0, y1))
  return p.blocks
    .filter((b) => {
      const r = p.tracks.findIndex((t) => t.id === b.track)
      return r >= ra && r <= rb && b.start < tb && b.start + b.length > ta
    })
    .map((b) => b.id)
}

/** Shift で押したとき: 起点から押したものまでの、トラックと時間の範囲の波形ブロックの id */
export function rangeSelectIds(p: Project, from: Block, to: Block): string[] {
  const row = (b: Block) => p.tracks.findIndex((t) => t.id === b.track)
  const [r0, r1] = [Math.min(row(from), row(to)), Math.max(row(from), row(to))]
  const t0 = Math.min(from.start, to.start)
  const t1 = Math.max(from.start + from.length, to.start + to.length)
  return p.blocks.filter((b) => row(b) >= r0 && row(b) <= r1 && b.start < t1 && b.start + b.length > t0).map((b) => b.id)
}
