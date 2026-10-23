// エンベロープの点（音量とピッチ）と、点から次の点までの形状。値の読み出しは画面を知らない純粋な関数
/** 点から次の点までの形状（REAPER と同じく、点ごとに持つ。省けば直線） */
export type EnvShape = 'linear' | 'square' | 'slowStartEnd' | 'fastStart' | 'fastEnd' | 'bezier'
export interface Shaped {
  shape?: EnvShape
  /** bezier の張り具合（−1〜1。0 で直線。正で前半を速く、負で遅くする） */
  tension?: number
}

/** 区間の進み具合 x（0〜1）を、形状に従った進み具合（0〜1）にする */
export function shapeProgress(shape: EnvShape | undefined, x: number, tension = 0): number {
  switch (shape) {
    case 'square': return x < 1 ? 0 : 1
    case 'slowStartEnd': return (1 - Math.cos(Math.PI * x)) / 2
    case 'fastStart': return 1 - (1 - x) ** 2
    case 'fastEnd': return x * x
    case 'bezier': return x + tension * x * (1 - x)
    default: return x
  }
}

/** 点の並びを逆にしたときの、点に持たせる形状（区間の向きが逆になるので、速い始まりと速い終わりを入れ替え、張り具合の向きを変える） */
export function mirrorShape(s: Shaped): Shaped {
  const shape: EnvShape | undefined = s.shape === 'fastStart' ? 'fastEnd' : s.shape === 'fastEnd' ? 'fastStart' : s.shape
  return { ...(shape ? { shape } : {}), ...(s.tension ? { tension: -s.tension } : {}) }
}

/** 区間 a→b の、位置 u（0〜1）の値。形状は a が持つ */
const between = (a: number, b: number, u: number, s: Shaped) => a + (b - a) * shapeProgress(s.shape, u, s.tension)

/** エンベロープの点（波形ブロックの頭からの秒と dB。t の順に並べる） */
export interface EnvPoint extends Shaped {
  t: number
  db: number
}

/** エンベロープの範囲（dB） */
export const ENV_MIN = -60
export const ENV_MAX = 12
export const VOLUME_ENV_RANGES = [6, 12, 24, 36, 48, 60] as const
export type VolumeEnvelopeRange = (typeof VOLUME_ENV_RANGES)[number]

/** 波形ブロックの頭から t 秒のエンベロープの値（dB）。点の間は dB で、前の点の形状に従い（既定は直線）、外は端の点の値 */
export function envAt(env: EnvPoint[] | undefined, t: number): number {
  if (!env?.length) return 0
  if (t <= env[0].t) return env[0].db
  for (let i = 1; i < env.length; i++) {
    const a = env[i - 1]
    const b = env[i]
    if (t <= b.t) return b.t === a.t ? b.db : between(a.db, b.db, (t - a.t) / (b.t - a.t), a)
  }
  return env[env.length - 1].db
}

/** ピッチのエンベロープの点（元の音の時刻 s 秒と半音。s の順に並べる） */
export interface PitchPoint extends Shaped {
  s: number
  st: number
}

/** ピッチのエンベロープの範囲（半音。上下とも） */
export const PITCH_ENV_MAX = 12
export const PITCH_ENV_RANGES = [1, 2, 3, 6, 12] as const
export type PitchEnvelopeRange = (typeof PITCH_ENV_RANGES)[number]

/** 元の音の時刻 s 秒のピッチのエンベロープの値（半音）。点の間は前の点の形状に従い（既定は直線）、外は端の点の値 */
export function pitchEnvAt(env: PitchPoint[] | undefined, s: number): number {
  if (!env?.length) return 0
  if (s <= env[0].s) return env[0].st
  for (let i = 1; i < env.length; i++) {
    const a = env[i - 1]
    const b = env[i]
    if (s <= b.s) return b.s === a.s ? b.st : between(a.st, b.st, (s - a.s) / (b.s - a.s), a)
  }
  return env[env.length - 1].st
}
