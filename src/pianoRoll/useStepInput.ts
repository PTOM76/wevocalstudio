// ステップ入力: 鍵盤（MIDI キーボードか画面の鍵盤）を弾くたびに、入力位置に音符を置き、鍵盤を全部離したら入力位置を音符の長さだけ進める（和音は同時に押した分が同じ位置に入る）
import { useEffect, useRef, useState } from 'react'
import { newId, type Note } from '../project'
import { subscribeNote } from './noteBus'

export function useStepInput(o: {
  notes: Note[]
  /** ブロックの長さ（拍） */
  len: number
  /** 置く音符の長さ（拍） */
  dur: () => number
  onChange: (notes: Note[], merge?: string) => void
  setSelected: (ids: string[]) => void
}) {
  const [on, setOn] = useState(false)
  const [at, setAt] = useState(0)
  const pressed = useRef(new Set<number>())
  // 受け取った時点の最新の値を使う（購読をつなぎ直さずに済むように）
  const latest = useRef({ ...o, on, at })
  latest.current = { ...o, on, at }

  /** 弾いた音。ステップ入力がオフなら何もしない */
  const note = (pitch: number, vel: number, down: boolean) => {
    const s = latest.current
    if (!s.on) return
    if (down) {
      if (s.at >= s.len - 1e-6) return
      const n: Note = { id: newId(), t: s.at, dur: Math.min(s.dur(), s.len - s.at), pitch, vel: Math.max(0.05, vel) }
      s.onChange([...s.notes, n], 'step')
      s.setSelected([n.id])
      pressed.current.add(pitch)
    } else if (pressed.current.delete(pitch) && pressed.current.size === 0) setAt(Math.min(s.len, s.at + s.dur()))
  }
  useEffect(() => subscribeNote((pitch, vel, down) => note(pitch, vel, down)), [])
  // オフにしたら、押している音の記録を捨てる
  useEffect(() => void (on || pressed.current.clear()), [on])

  /** 休符: 入力位置を音符の長さだけ進める */
  const rest = () => setAt((a) => Math.min(latest.current.len, a + latest.current.dur()))
  /** オン、オフを切り替える（on を渡せばそれに）。オンにするときは、入力位置を startAt（拍）にする */
  const toggle = (startAt: number, to?: boolean) => {
    const next = to ?? !latest.current.on
    if (next) setAt(startAt)
    setOn(next)
  }
  return { on, at, note, rest, toggle }
}
