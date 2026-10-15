// ピッチの一括操作（wevocal-lib の計算。WeVocalSynth と同じ）を、波形ブロックのピッチカーブにする。元の F0 との差を半音で持つ（ペンと同じ形）
import type { Range } from 'wevocal-lib'
import { CURVE_HOP, type Block, type PitchCurve } from './project'

/** 計算の形（今の目標ピッチ（Hz。無声は 0）、元の F0、フレームの範囲 → 新しい目標ピッチ） */
export type PitchTool = (cur: Float32Array, f0: Float32Array, k0: number, k1: number) => Float32Array

/** 元の音の時刻 s のピッチカーブの値（半音。なければ 0） */
const curveAt = (c: PitchCurve | undefined, s: number) => {
  if (!c) return 0
  const i = Math.round((s - c.from) / CURVE_HOP)
  return i >= 0 && i < c.st.length ? c.st[i] : 0
}

/** 範囲（時間軸の秒）を、元の F0 のフレームの範囲にする。範囲がない、または波形ブロックにかからなければ全体 */
export function frameRange(b: Block, frames: number, hop: number, range: Range | null): [number, number] {
  const s = range ? Math.max(b.start, range.start) : b.start
  const e = range ? Math.min(b.start + b.length, range.end) : b.start + b.length
  if (!range || e <= s) return [0, frames - 1]
  // 時間軸の秒 → 元の音の頭（offset）からの秒 → フレーム
  return [Math.max(0, Math.floor(((s - b.start) * b.rate) / hop)), Math.min(frames - 1, Math.ceil(((e - b.start) * b.rate) / hop))]
}

/**
 * `tool` を、波形ブロックの今の目標ピッチ（元の F0 × 基本のピッチ × カーブ）に掛け、新しいピッチカーブを返す。
 * `f0` は元の音の offset から `hop` 秒ごとの F0（Hz。無声は 0）
 */
export function applyPitchTool(b: Block, f0: Float32Array, hop: number, range: Range | null, tool: PitchTool): PitchCurve {
  const cur = new Float32Array(f0.length)
  for (let k = 0; k < f0.length; k++) if (f0[k] > 0) cur[k] = f0[k] * 2 ** ((b.pitch + curveAt(b.curve, b.offset + k * hop)) / 12)
  const [k0, k1] = frameRange(b, f0.length, hop, range)
  const out = tool(cur, f0, k0, k1)
  // カーブは CURVE_HOP ごと。F0 のフレームと刻みが違えば、近いフレームの値を使う
  const n = Math.ceil((f0.length * hop) / CURVE_HOP)
  const st = new Array<number>(n)
  for (let i = 0; i < n; i++) {
    const k = Math.min(f0.length - 1, Math.round((i * CURVE_HOP) / hop))
    st[i] = f0[k] > 0 && out[k] > 0 ? 12 * Math.log2(out[k] / f0[k]) - b.pitch : curveAt(b.curve, b.offset + i * CURVE_HOP)
  }
  return { from: b.offset, st }
}
