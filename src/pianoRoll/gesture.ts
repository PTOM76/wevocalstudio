// ピアノロールの操作中の状態（RollGesture。同時に 1 つだけ）と、ドラッグで音符がどう変わるかの計算（動かす、長さを変える、枠で選ぶ）。計算は状態に触れない純粋な関数で、PianoRoll が毎回の動きで呼ぶ
import { useRef } from 'react'
import type { Note } from '../project'
import { KEYS, pitchY, rowPitch, xBeat, type View } from './view'

/** 動かしたとき、動かし始めたときの音符 start から、選んだものを (dBeat, dPitch) だけずらす。選んだものが全部 [0, len] と [0, 127] に収まる範囲で */
export function movedNotes(current: Note[], start: Note[], selected: string[], dBeat: number, dPitch: number, len: number): Note[] {
  const ix = start.flatMap((n, i) => (selected.includes(n.id) ? [i] : []))
  if (!ix.length) return current
  const s = Math.max(Math.max(...ix.map((i) => -start[i].t)), Math.min(Math.min(...ix.map((i) => len - start[i].dur - start[i].t)), dBeat))
  const pp = Math.max(Math.max(...ix.map((i) => -start[i].pitch)), Math.min(Math.min(...ix.map((i) => 127 - start[i].pitch)), dPitch))
  const out = current.map((n) => ({ ...n }))
  for (const i of ix) out[i] = { ...start[i], t: start[i].t + s, pitch: start[i].pitch + pp }
  return out
}

/** 長さを変えたとき、選んだものの長さを dBeat だけ変える（最短は step、ブロックの終わりまで） */
export function sizedNotes(current: Note[], start: Note[], selected: string[], dBeat: number, len: number, step: number): Note[] {
  const out = current.map((n) => ({ ...n }))
  for (const [i, n] of start.entries()) if (selected.includes(n.id)) out[i] = { ...n, dur: Math.max(step, Math.min(len - n.t, n.dur + dBeat)) }
  return out
}

/** 枠 (x0, y0)〜(x1, y1)（画面の座標）にかかる音符の id */
export function notesInBox(notes: Note[], view: View, x0: number, y0: number, x1: number, y1: number): string[] {
  const [xa, xb] = [Math.min(x0, x1), Math.max(x0, x1)]
  const [ya, yb] = [Math.min(y0, y1), Math.max(y0, y1)]
  return notes.flatMap((n) => {
    const ny = pitchY(view, n.pitch)
    if (ny === -Infinity) return []
    const nx0 = KEYS + (n.t - view.left) * view.ppb
    const nx1 = nx0 + Math.max(3, n.dur * view.ppb)
    return nx1 >= xa && nx0 <= xb && ny + view.row >= ya && ny <= yb ? [n.id] : []
  })
}

/** 動かし始めた位置 (beat0、pitch0) から今の画面の位置 (x, y) までの差（拍と音の高さ）。拍は snap で丸める */
export function dragDelta(view: View, x: number, y: number, beat0: number, pitch0: number, snap: (beat: number) => number) {
  return { dBeat: snap(xBeat(view, x) - beat0), dPitch: rowPitch(view, y) - pitch0 }
}

/** 押してから離すまでの操作。時間軸（timeline/gesture.ts）と同じく、同時に 1 つだけ */
export type RollGesture =
  | { kind: 'move'; start: Note[]; beat0: number; pitch0: number; merge: string }
  | { kind: 'size'; start: Note[]; beat0: number; merge: string }
  | { kind: 'vel'; id: string; merge: string }
  | { kind: 'point'; index: number; merge: string }
  | { kind: 'box'; x0: number; y0: number }
  | { kind: 'key' }
  | { kind: 'laneSize'; y0: number; h0: number }
  /** 指 1 本で空いている所をなぞる: スクロール（動かさずに離すと音符を足し、長押しすると枠で選ぶ） */
  | { kind: 'pan'; x: number; y: number; cx: number; cy: number; left0: number; low0: number; t0: number; moved: boolean; timer: number }
  | { kind: 'erase'; merge: string }
  | { kind: 'mute'; value: boolean; merge: string }

/** 今の操作を入れる窓口（`.current`）。書き替えると前の操作は終わる（なぞりの長押しのタイマーも止める） */
export function rollGestureSlot(ref: { current: RollGesture | null }) {
  return {
    get current() {
      return ref.current
    },
    set current(g: RollGesture | null) {
      const old = ref.current
      if (old?.kind === 'pan' && old !== g) clearTimeout(old.timer)
      ref.current = g
    },
  }
}

export function useRollGesture() {
  const ref = useRef<RollGesture | null>(null)
  return useRef(rollGestureSlot(ref)).current
}
