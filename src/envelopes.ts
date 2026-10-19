// エンベロープの種類（音量とピッチ）。点の読み書きと、波形ブロックの中の縦の位置と値の換算をまとめる（時間軸の編集と描画で共通）
import { envY, envDb } from './blockDrag'
import { ENV_MAX, ENV_MIN, PITCH_ENV_MAX, PITCH_ENV_RANGES, VOLUME_ENV_RANGES, type Block } from './project'

export type EnvKind = 'volume' | 'pitch'

/** 時間軸で扱う点（波形ブロックの頭からの秒と値） */
export interface EnvPt {
  t: number
  v: number
}

interface EnvSpec {
  /** 点の一覧（波形ブロックの頭からの秒） */
  points: (b: Block) => EnvPt[]
  /** 点の一覧を、波形ブロックに書く値にする */
  patch: (b: Block, pts: EnvPt[]) => Partial<Block>
  /** 値から、波形ブロックの中の縦の位置（0 が上、1 が下） */
  y: (v: number, range: number) => number
  /** 縦の位置から値（範囲に収めて丸める） */
  value: (frac: number, range: number) => number
  /** 点がないときの値 */
  zero: number
  /** 設定とブロックに保存する表示範囲 */
  ranges: readonly number[]
  defaultRange: (b: Block, fallback: number) => number
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

export const ENVELOPES: Record<EnvKind, EnvSpec> = {
  // 音量（dB）。点は波形ブロックの頭からの秒で持つ
  volume: {
    points: (b) => (b.envelope ?? []).map((p) => ({ t: p.t, v: p.db })),
    patch: (_, pts) => ({ envelope: pts.map((p) => ({ t: p.t, db: p.v })) }),
    y: (v, range) => envY(clamp(v, -range, ENV_MAX), range),
    value: (f, range) => Math.round(clamp(envDb(f, range), -range, ENV_MAX) * 10) / 10,
    zero: 0,
    ranges: VOLUME_ENV_RANGES,
    defaultRange: (b, fallback) => b.envelopeRange ?? fallback,
  },
  // ピッチ（半音。基本のピッチに足す）。点は元の音の時刻で持つ（分割や端の調整をしてもずれない。ピッチカーブと同じ）
  pitch: {
    points: (b) => (b.pitchEnvelope ?? []).map((p) => ({ t: (p.s - b.offset) / b.rate, v: p.st })),
    patch: (b, pts) => ({ pitchEnvelope: pts.map((p) => ({ s: b.offset + p.t * b.rate, st: p.v })) }),
    y: (v, range = PITCH_ENV_MAX) => 0.5 - clamp(v, -range, range) / (2 * range),
    value: (f, range = PITCH_ENV_MAX) => Math.round(clamp((0.5 - f) * 2 * range, -range, range) * 10) / 10,
    zero: 0,
    ranges: PITCH_ENV_RANGES,
    defaultRange: (b, fallback) => b.pitchEnvelopeRange ?? fallback,
  },
}

export function envelopeRange(kind: EnvKind, b: Block, defaultRange: number): number {
  return ENVELOPES[kind].defaultRange(b, defaultRange)
}

/** 押した所にある点の番号（なければ -1） */
export function hitEnvPoint(kind: EnvKind, b: Block, x: number, y: number, blockX: number, top: number, h: number, pps: number, range?: number) {
  const s = ENVELOPES[kind]
  const actualRange = range ?? s.defaultRange(b, kind === 'pitch' ? PITCH_ENV_MAX : -ENV_MIN)
  return s.points(b).findIndex((pt) => Math.hypot(blockX + pt.t * pps - x, top + s.y(pt.v, actualRange) * h - y) < 7)
}
