// 時間軸のホイール操作。Shift で横に動かし、Ctrl（設定ではホイールだけ）で拡大と縮小（マウスの位置を中心に）、そのほかは縦にスクロールする。1 フレームぶんをまとめて 1 回だけ反映する
import { useEffect } from 'react'
import type { TimelineView } from '../drawTimeline'
import { localPos } from './geometry'

export function useTimelineWheel(o: {
  canvasRef: { current: HTMLCanvasElement | null }
  wheelZoomRef: { current: 'ctrl' | 'wheel' }
  /** 縦のスクロールの上限 */
  maxRef: { current: number }
  setVscroll: (fn: (v: number) => number) => void
  setView: (fn: (v: TimelineView) => TimelineView) => void
}) {
  const { canvasRef, wheelZoomRef, maxRef, setVscroll, setView } = o
  useEffect(() => {
    const canvas = canvasRef.current!
    // ホイールは 1 フレームぶんをまとめて 1 回だけ反映する（描き直しは重く、再生中にたくさん描くと、音が途切れる原因になる）
    const acc = { vy: 0, sx: 0, zoom: 1, zx: 0, raf: 0 }
    const localX = (e: WheelEvent) => localPos(canvas, e).x
    const flush = () => {
      acc.raf = 0
      const { vy, sx, zoom, zx } = acc
      acc.vy = acc.sx = 0
      acc.zoom = 1
      if (vy) setVscroll((v) => Math.max(0, Math.min(maxRef.current, v + vy)))
      if (sx || zoom !== 1)
        setView((v) => {
          const pps = Math.min(2000, Math.max(2, v.pps * zoom))
          return { pps, scroll: Math.max(0, v.scroll + zx / v.pps - zx / pps + sx / pps) }
        })
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const modifier = e.ctrlKey || e.metaKey
      const zooming = wheelZoomRef.current === 'wheel' ? !modifier && !e.shiftKey && !e.deltaX : modifier
      // 拡大縮小でも横スクロールでもなければ縦にスクロール
      if (!zooming && !e.shiftKey && !e.deltaX) acc.vy += e.deltaY
      else if (zooming) {
        acc.zoom *= e.deltaY < 0 ? 1.2 : 1 / 1.2
        acc.zx = localX(e)
      } else acc.sx += e.deltaX || e.deltaY
      if (!acc.raf) acc.raf = requestAnimationFrame(flush)
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      canvas.removeEventListener('wheel', onWheel)
      cancelAnimationFrame(acc.raf)
    }
  }, [setView])
}
