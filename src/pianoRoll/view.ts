// ピアノロールの表示の位置と大きさ（拍と音の高さ、画面の座標の変換）。画面を知らない

/** 鍵盤の列の幅（px） */
export const KEYS = 44
/** 下の強さの帯の高さと、上との間（px） */
export const VEL = 64
export const GAP = 6
/** 音符の右端をつかめる幅（px） */
export const EDGE = 6
export const ROW_MIN = 8
export const ROW_MAX = 32
export const BLACK = new Set([1, 3, 6, 8, 10])
export const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

export interface View {
  /** 左端の位置（拍） */
  left: number
  /** 1 拍の幅（px） */
  ppb: number
  /** 見えている一番下の音 */
  low: number
  /** 1 行の高さ（px） */
  row: number
  /** 全体の大きさ（px） */
  w: number
  h: number
}

/** 音の高さを書く行の数 */
export const rowsOf = (v: View) => Math.max(1, Math.floor((v.h - GAP - VEL) / v.row))
/** 音符を置く部分の高さ（px） */
export const rollHeight = (v: View) => rowsOf(v) * v.row
export const beatX = (v: View, beat: number) => KEYS + (beat - v.left) * v.ppb
export const xBeat = (v: View, x: number) => (x - KEYS) / v.ppb + v.left
export const rowPitch = (v: View, y: number) => v.low + rowsOf(v) - 1 - Math.floor(y / v.row)
export const pitchY = (v: View, pitch: number) => (rowsOf(v) - 1 - (pitch - v.low)) * v.row
/** 見えている幅（拍） */
export const visibleBeats = (v: View) => Math.max(0, (v.w - KEYS) / v.ppb)

/** 見える範囲を、ブロックの中と音の高さの範囲（0〜127）に収める */
export function clampView(v: View, len: number): View {
  const rows = rowsOf(v)
  const low = Math.max(0, Math.min(127 - rows + 1, v.low))
  const left = Math.max(0, Math.min(Math.max(0, len - visibleBeats(v)), v.left))
  return { ...v, left, low }
}

/** グリッドの細かさ（4 分音符を 1 とした拍での間隔）。4 なら 1 拍、16 なら 16 分音符、3 や 6 なら 3 連符 */
export const stepOf = (division: number) => 4 / Math.max(1, division)
