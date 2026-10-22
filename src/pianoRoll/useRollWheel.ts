// ピアノロールのホイール: Ctrl で横の拡大（マウスの位置を動かさない）、Shift で横のスクロール、Alt で行の高さ、そのままで音の高さ。ページごと動かないよう passive にしない
import { useEffect, type RefObject } from 'react'
import { localPoint } from 'pevenmui'
import { KEYS, ROW_MAX, ROW_MIN, xBeat, type View } from './view'

export function useRollWheel(canvas: RefObject<HTMLCanvasElement | null>, viewRef: RefObject<View>, set: { zoom: (ppb: number) => void; left: (beat: number) => void; row: (px: number) => void; low: (pitch: number) => void }) {
  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const v = viewRef.current
      const dir = e.deltaY > 0 ? 1 : -1
      if (e.ctrlKey) {
        const at = localPoint(el, e.clientX, e.clientY).x
        const ppb = Math.max(2, Math.min(2000, v.ppb * (dir > 0 ? 0.85 : 1 / 0.85)))
        const beat = xBeat(v, at)
        set.zoom(ppb)
        set.left(Math.max(0, beat - (at - KEYS) / ppb))
      } else if (e.shiftKey) set.left(Math.max(0, v.left + (dir * 60) / v.ppb))
      else if (e.altKey) set.row(Math.max(ROW_MIN, Math.min(ROW_MAX, v.row - dir)))
      else set.low(v.low - dir * 2)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
