// エンベロープの種類（音量とピッチ）。点の読み書きと、波形ブロックの中の縦の位置と値の換算をまとめる（時間軸の編集と描画で共通）
import { envY, envDb } from './blockDrag'
import { ENV_MAX, ENV_MIN, PITCH_ENV_MAX, type Block } from './project'

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
  y: (v: number) => number
  /** 縦の位置から値（範囲に収めて丸める） */
  value: (frac: number) => number
  /** 点がないときの値 */
  zero: number
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

export const ENVELOPES: Record<EnvKind, EnvSpec> = {
  // 音量（dB）。点は波形ブロックの頭からの秒で持つ
  volume: {
    points: (b) => (b.envelope ?? []).map((p) => ({ t: p.t, v: p.db })),
    patch: (_, pts) => ({ envelope: pts.map((p) => ({ t: p.t, db: p.v })) }),
    y: envY,
    value: (f) => Math.round(clamp(envDb(f), ENV_MIN, ENV_MAX) * 10) / 10,
    zero: 0,
  },
  // ピッチ（半音。基本のピッチに足す）。点は元の音の時刻で持つ（分割や端の調整をしてもずれない。ピッチカーブと同じ）
  pitch: {
    points: (b) => (b.pitchEnvelope ?? []).map((p) => ({ t: (p.s - b.offset) / b.rate, v: p.st })),
    patch: (b, pts) => ({ pitchEnvelope: pts.map((p) => ({ s: b.offset + p.t * b.rate, st: p.v })) }),
    y: (v) => 0.5 - v / (2 * PITCH_ENV_MAX),
    value: (f) => Math.round(clamp((0.5 - f) * 2 * PITCH_ENV_MAX, -PITCH_ENV_MAX, PITCH_ENV_MAX) * 10) / 10,
    zero: 0,
  },
}

/** 押した所にある点の番号（なければ -1） */
export function hitEnvPoint(kind: EnvKind, b: Block, x: number, y: number, blockX: number, top: number, h: number, pps: number) {
  const s = ENVELOPES[kind]
  return s.points(b).findIndex((pt) => Math.hypot(blockX + pt.t * pps - x, top + s.y(pt.v) * h - y) < 7)
}
