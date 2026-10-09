// 時間軸。左にトラックの欄、右に波形ブロックを並べた canvas。波形ブロックはドラッグで動かし、ほかのトラックへも移せる
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Box, useTheme } from '@mui/material'
import { LANE, RULER, drawTimeline, type TimelineView } from './drawTimeline'
import type { Block, Project, Track } from './project'
import TrackHeader from './TrackHeader'

const HEADER = 200

interface Drag {
  id: string
  x: number
  y: number
  start: number
  trackIndex: number
}

export default function Timeline(p: {
  project: Project
  cursor: number
  selected: string | null
  onSelect: (id: string | null) => void
  onSeek: (t: number) => void
  onTrackChange: (id: string, patch: Partial<Track>) => void
  onBlockChange: (id: string, patch: Partial<Block>) => void
}) {
  const dark = useTheme().palette.mode === 'dark'
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [view, setView] = useState<TimelineView>({ scroll: 0, pps: 50 })
  const [width, setWidth] = useState(0)
  const drag = useRef<Drag | null>(null)
  const height = RULER + Math.max(1, p.project.tracks.length) * LANE

  // 幅に合わせる
  useLayoutEffect(() => {
    const box = canvasRef.current!.parentElement!
    const ro = new ResizeObserver(() => setWidth(box.clientWidth))
    ro.observe(box)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current!
    canvas.width = width * devicePixelRatio
    canvas.height = height * devicePixelRatio
    drawTimeline(canvas, p.project, view, p.selected, p.cursor, {
      bg: dark ? '#1e1f22' : '#fafafa',
      lane: dark ? '#3a3b3e' : '#ddd',
      line: dark ? '#2c2d30' : '#eee',
      text: dark ? '#ddd' : '#333',
      block: dark ? '#2f4f6f' : '#c5daf0',
      blockSelected: dark ? '#3f6f9f' : '#9cc2ea',
      wave: dark ? '#9fd0ff' : '#1565c0',
      playhead: '#e53935',
    })
  }, [p.project, view, p.selected, p.cursor, width, height, dark])

  // ホイール: Shift で横に動かす。Ctrl で拡大と縮小（マウスの位置を中心に）
  useEffect(() => {
    const canvas = canvasRef.current!
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.shiftKey && !e.deltaX) return
      e.preventDefault()
      const x = e.offsetX
      setView((v) => {
        if (e.ctrlKey) {
          const pps = Math.min(2000, Math.max(2, v.pps * (e.deltaY < 0 ? 1.2 : 1 / 1.2)))
          return { pps, scroll: Math.max(0, v.scroll + x / v.pps - x / pps) }
        }
        return { ...v, scroll: Math.max(0, v.scroll + (e.deltaX || e.deltaY) / v.pps) }
      })
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [])

  const toTime = (x: number) => view.scroll + x / view.pps

  const hit = (x: number, y: number) => {
    const track = p.project.tracks[Math.floor((y - RULER) / LANE)]
    if (!track) return null
    const t = toTime(x)
    // 後に置いたものが上に描かれるので、後ろから探す
    return p.project.blocks.findLast((b) => b.track === track.id && t >= b.start && t < b.start + b.length) ?? null
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { offsetX: x, offsetY: y } = e.nativeEvent
    const b = y > RULER ? hit(x, y) : null
    if (!b) {
      p.onSelect(null)
      p.onSeek(Math.max(0, toTime(x)))
      return
    }
    p.onSelect(b.id)
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { id: b.id, x, y, start: b.start, trackIndex: p.project.tracks.findIndex((t) => t.id === b.track) }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current
    if (!d) return
    const { offsetX: x, offsetY: y } = e.nativeEvent
    const i = Math.min(p.project.tracks.length - 1, Math.max(0, d.trackIndex + Math.round((y - d.y) / LANE)))
    p.onBlockChange(d.id, { start: Math.max(0, d.start + (x - d.x) / view.pps), track: p.project.tracks[i].id })
  }

  return (
    <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', alignItems: 'flex-start' }}>
      <Box sx={{ width: HEADER, flexShrink: 0, borderRight: 1, borderColor: 'divider' }}>
        <Box sx={{ height: RULER, borderBottom: 1, borderColor: 'divider', boxSizing: 'border-box' }} />
        {p.project.tracks.map((track) => (
          <TrackHeader key={track.id} track={track} height={LANE} onChange={(patch) => p.onTrackChange(track.id, patch)} />
        ))}
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <canvas
          ref={canvasRef}
          style={{ display: 'block', width, height, touchAction: 'none' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={() => (drag.current = null)}
        />
      </Box>
    </Box>
  )
}
