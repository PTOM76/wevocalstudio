// REAPER のピッチの処理方式（PLAYRATE の 4 つ目、DEFPITCHMODE）と Studio の処理方式の対応、テイクのエンベロープ（<PITCHENV>、<VOLENV>）と Studio のエンベロープの変換（memo/daw-exchange.md）
import type { Algorithm } from 'wevocal-lib'
import type { EnvShape } from '../envelopeCurve'

/**
 * REAPER の処理方式の種類。番号は上位 16 ビットが方式、下位 16 ビットがその中の種類。
 * 9〜11 が élastique 3（Pro、Efficient、Soloist）、6〜8 が élastique 2 の同じ並び（9 が Pro なのは REAPER のスクリプトの例から。ほかは並びからの推測）
 */
export type ReaperPitchKind = 'soloist' | 'pro' | 'efficient' | 'other'

export function reaperPitchKind(mode: number): ReaperPitchKind {
  const shifter = mode >>> 16
  if (shifter === 8 || shifter === 11) return 'soloist'
  if (shifter === 6 || shifter === 9) return 'pro'
  if (shifter === 7 || shifter === 10) return 'efficient'
  return 'other'
}

/** 種類ごとの Studio の処理方式とフォルマントを保つか（設定で変えられる） */
export type ReaperPitchMap = Record<ReaperPitchKind, { algorithm: Algorithm; preserveFormant: boolean }>

/** 書き出しで使う番号（élastique 3 の Soloist と Pro） */
export const REAPER_SOLOIST = 11 << 16
export const REAPER_PRO = 9 << 16

/** 声向けの方式（書き出しでは Soloist にする） */
const VOICE: readonly Algorithm[] = ['sola3', 'sola2', 'psola2', 'psolad', 'psola', 'sola', 'wsola2', 'wsola']
export const reaperModeFor = (algorithm: Algorithm) => (VOICE.includes(algorithm) ? REAPER_SOLOIST : REAPER_PRO)

/** エンベロープの点の形（REAPER の番号と同じ並び。5 はベジェで、張り具合を持つ） */
const SHAPES: EnvShape[] = ['linear', 'square', 'slowStartEnd', 'fastStart', 'fastEnd', 'bezier']
export const shapeFromReaper = (n: number): EnvShape | undefined => (n > 0 && n < SHAPES.length ? SHAPES[n] : undefined)
export const shapeToReaper = (s: EnvShape | undefined) => Math.max(0, SHAPES.indexOf(s ?? 'linear'))

/** 中間の形のエンベロープの点（アイテムの頭からの秒、値、形、張り具合） */
export interface XEnvPoint {
  t: number
  v: number
  shape?: EnvShape
  tension?: number
}

/**
 * 細かい点の並び（ピッチカーブを 10 ms ごとに読んだもの）を、前後の点を直線で結んでも tol 以内に収まる点だけに減らす（Ramer–Douglas–Peucker）
 */
export function simplify(points: XEnvPoint[], tol: number): XEnvPoint[] {
  if (points.length <= 2) return points
  const keep = new Uint8Array(points.length)
  keep[0] = keep[points.length - 1] = 1
  const stack: [number, number][] = [[0, points.length - 1]]
  while (stack.length) {
    const [a, z] = stack.pop()!
    let worst = -1
    let far = tol
    for (let i = a + 1; i < z; i++) {
      const u = (points[i].t - points[a].t) / (points[z].t - points[a].t || 1)
      const d = Math.abs(points[i].v - (points[a].v + (points[z].v - points[a].v) * u))
      if (d > far) {
        far = d
        worst = i
      }
    }
    if (worst >= 0) {
      keep[worst] = 1
      stack.push([a, worst], [worst, z])
    }
  }
  return points.filter((_, i) => keep[i])
}

/** 対応表の既定。Soloist は声向けの Vesola でフォルマントを保ち、Pro と Efficient は Phasera v2 でフォルマントを保たない */
export const DEFAULT_REAPER_PITCH_MAP: ReaperPitchMap = {
  soloist: { algorithm: 'sola3', preserveFormant: true },
  pro: { algorithm: 'pv2', preserveFormant: false },
  efficient: { algorithm: 'pv2', preserveFormant: false },
  other: { algorithm: 'sola3', preserveFormant: true },
}
