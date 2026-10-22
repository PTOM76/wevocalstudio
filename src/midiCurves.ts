// MIDI ブロックのコントロール（CC とピッチベンドの曲線）の計算。点を直線でつなぐ。画面を知らない
import type { MidiCurve } from './project'

/** 点の値の範囲（ピッチベンドは -1〜1、そのほかは 0〜1） */
export const curveRange = (c: Pick<MidiCurve, 'kind'>): [number, number] => (c.kind === 'bend' ? [-1, 1] : [0, 1])

/** 同じコントロールか（種類と CC の番号が同じ） */
export const sameCurve = (a: Pick<MidiCurve, 'kind' | 'cc'>, kind: MidiCurve['kind'], cc = 0) => a.kind === kind && (a.cc ?? 0) === cc

/** 曲線の t 拍での値（点の外は端の値。点がなければ null） */
export function curveAt(points: { t: number; v: number }[], t: number): number | null {
  if (!points.length) return null
  if (t <= points[0].t) return points[0].v
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    if (t <= b.t) return b.t === a.t ? b.v : a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t)
  }
  return points[points.length - 1].v
}

/** 点を t の順に並べる */
export const sortPoints = (points: { t: number; v: number }[]) => [...points].sort((a, b) => a.t - b.t)

/** 曲線を、音源に送る離散の値の列にする（直線の区間は、step 拍おきの階段にする。最後の点は len 拍まで続く） */
export function curveSteps(points: { t: number; v: number }[], len: number, step = 1 / 32): { t: number; v: number }[] {
  const out: { t: number; v: number }[] = []
  const pts = sortPoints(points).filter((p) => p.t <= len)
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    out.push(a)
    const b = pts[i + 1]
    if (b && b.v !== a.v) for (let t = a.t + step; t < b.t - 1e-9; t += step) out.push({ t, v: curveAt(pts, t)! })
  }
  return out
}

/** ブロックを at 拍で分けたときの、前と後ろの曲線（後ろは頭を 0 拍にし、分けた位置の値を頭に置く） */
export function splitCurves(curves: MidiCurve[] | undefined, at: number): [MidiCurve[] | undefined, MidiCurve[] | undefined] {
  if (!curves?.length) return [undefined, undefined]
  const left = curves.flatMap((c) => {
    const points = c.points.filter((p) => p.t <= at)
    return points.length ? [{ ...c, points }] : []
  })
  const right = curves.flatMap((c) => {
    const v = curveAt(sortPoints(c.points), at)
    if (v === null) return []
    const later = c.points.filter((p) => p.t > at).map((p) => ({ t: p.t - at, v: p.v }))
    return [{ ...c, points: [{ t: 0, v }, ...later] }]
  })
  return [left.length ? left : undefined, right.length ? right : undefined]
}
