// ピアノロールの 2 本指のつまみ（拡大と縮小、なぞって縦横にスクロール）。触れている指の位置を覚える
import { useRef, type RefObject } from 'react'
import { localPoint } from 'pevenmui'
import { KEYS, xBeat, type View } from './view'

export function usePinch(canvas: RefObject<HTMLCanvasElement | null>, set: { zoom: (ppb: number) => void; left: (beat: number) => void; low: (pitch: number) => void }) {
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const state = useRef<{ dist0: number; ppb0: number; beat: number; y0: number; low0: number } | null>(null)
  /** 触れている 2 本の指の、間の長さと中点（キャンバスの座標） */
  const two = () => {
    const [a, b] = [...pointers.current.values()]
    return { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid: localPoint(canvas.current!, (a.x + b.x) / 2, (a.y + b.y) / 2) }
  }
  return {
    /** 指が触れた。2 本目なら、つまみを始める（true）。そのとき、ほかの操作は中止する */
    down(e: React.PointerEvent, view: View) {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pointers.current.size !== 2) return false
      const { dist, mid } = two()
      state.current = { dist0: dist, ppb0: view.ppb, beat: xBeat(view, mid.x), y0: mid.y, low0: view.low }
      return true
    },
    /** 指が動いた。つまみの最中なら、拡大とスクロールをして true */
    move(e: React.PointerEvent, view: View) {
      if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      const s = state.current
      if (!s || pointers.current.size !== 2) return false
      const { dist, mid } = two()
      const ppb = Math.max(2, Math.min(2000, (s.ppb0 * dist) / s.dist0))
      set.zoom(ppb)
      set.left(Math.max(0, s.beat - (mid.x - KEYS) / ppb))
      set.low(s.low0 + Math.round((mid.y - s.y0) / view.row))
      return true
    },
    /** 指が離れた */
    up(e?: React.PointerEvent) {
      if (e) pointers.current.delete(e.pointerId)
      if (pointers.current.size < 2) state.current = null
    },
  }
}
