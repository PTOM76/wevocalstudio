// ピアノロールで押した所の判定（音符、右端、強さの棒）。画面を知らない
import type { Note } from '../project'
import { EDGE, KEYS, beatX, rollHeight, rowPitch, xBeat, type View } from './view'

/** 押した所の音符（なければ -1）と、右端か */
export function hitNote(notes: Note[], v: View, x: number, y: number): { index: number; edge: boolean } {
  if (y >= rollHeight(v) || x < KEYS) return { index: -1, edge: false }
  const pitch = rowPitch(v, y)
  const beat = xBeat(v, x)
  const slop = 2 / v.ppb
  const index = notes.findLastIndex((n) => n.pitch === pitch && beat >= n.t - slop && beat <= n.t + n.dur + slop)
  const n = notes[index]
  return { index, edge: !!n && (n.t + n.dur - beat) * v.ppb < EDGE }
}

/** 強さの帯の、押した所の音符（棒の近く） */
export const hitVel = (notes: Note[], v: View, x: number) => notes.findLastIndex((n) => Math.abs(beatX(v, n.t) + 1 - x) < 4)
