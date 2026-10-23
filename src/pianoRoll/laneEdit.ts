// ピアノロールの下のレーン（強さ、ピッチベンド、CC）の曲線の編集。点の判定と、曲線の入れ替え。画面を知らない
import { curveRange, sameCurve, sortPoints } from '../midiCurves'
import type { MidiCurve } from '../project'
import { beatX, laneTop, type View } from './view'

/** レーン: 強さ、ピッチベンド、CC（番号付き） */
export type Lane = 'vel' | 'bend' | `cc${number}`

/** レーンの選択肢（よく使う CC） */
export const LANES: Lane[] = ['vel', 'bend', 'cc1', 'cc7', 'cc10', 'cc11', 'cc64']

/** 曲線のレーンなら、その種類と番号 */
export function curveOf(lane: Lane): { kind: MidiCurve['kind']; cc: number } | null {
  if (lane === 'vel') return null
  return lane === 'bend' ? { kind: 'bend', cc: 0 } : { kind: 'cc', cc: Number(lane.slice(2)) }
}

type Point = { t: number; v: number }

/** レーンの点（t の順） */
export function lanePoints(curves: MidiCurve[] | undefined, lane: Lane): Point[] {
  const c = curveOf(lane)
  const found = c && curves?.find((x) => sameCurve(x, c.kind, c.cc))
  return found ? sortPoints(found.points) : []
}

/** レーンの点を入れ替えた曲線の一覧（点がなくなれば、その曲線を外す。曲線がなくなれば undefined） */
export function withPoints(curves: MidiCurve[] | undefined, lane: Lane, points: Point[]): MidiCurve[] | undefined {
  const c = curveOf(lane)
  if (!c) return curves
  const rest = (curves ?? []).filter((x) => !sameCurve(x, c.kind, c.cc))
  const next = points.length ? [...rest, { kind: c.kind, ...(c.kind === 'cc' ? { cc: c.cc } : {}), points: sortPoints(points) }] : rest
  return next.length ? next : undefined
}

/** 値の範囲（レーンの高さ全体） */
const range = (lane: Lane) => curveRange({ kind: lane === 'bend' ? 'bend' : 'cc' })

/** 帯の上（y）の位置から値。ピッチベンドの真ん中の近くは 0 に吸い付く */
export function valueAt(v: View, lane: Lane, y: number): number {
  const [lo, hi] = range(lane)
  const top = laneTop(v)
  const val = lo + (1 - (y - top) / v.vel) * (hi - lo)
  const clamped = Math.max(lo, Math.min(hi, val))
  return lane === 'bend' && Math.abs(clamped) < 0.04 ? 0 : clamped
}

/** 値から、帯の上（y）の位置 */
export function valueY(v: View, lane: Lane, value: number): number {
  const [lo, hi] = range(lane)
  return laneTop(v) + v.vel * (1 - (value - lo) / (hi - lo))
}

/** 押した所の点の番号（なければ -1） */
export function hitPoint(points: Point[], v: View, lane: Lane, x: number, y: number): number {
  return points.findLastIndex((p) => Math.abs(beatX(v, p.t) - x) < 7 && Math.abs(valueY(v, lane, p.v) - y) < 7)
}
