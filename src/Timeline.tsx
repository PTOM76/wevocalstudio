// 時間軸。左にトラックの欄、右に波形ブロックを並べた canvas。波形ブロックはドラッグで動かし（ほかのトラックへも移せる）、端で長さ、上の角でフェードを変える
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Box } from '@mui/material'
import { SELECTION_DARK, SELECTION_LIGHT, alpha, type Range } from 'wevocal-lib'
import { usePalette } from 'pevenmui'
import { CURSOR, dragPatch, hitBlock, snapDelta, snapTargets, snapTime, type Drag } from './blockDrag'
import { LANE, MASTER, RULER, TOP, drawTimeline, type TimelineView } from './drawTimeline'
import type { Block, Master, Project, Track } from './project'
import TrackHeader, { MasterHeader } from './TrackHeader'
import type { DropAt } from './useProject'

const HEADER = 200

export default function Timeline(p: {
  project: Project
  cursor: number
  selected: string | null
  onSelect: (id: string | null) => void
  selectedTrack: string | null
  onSelectTrack: (id: string) => void
  onSeek: (t: number) => void
  range: Range | null
  onRange: (r: Range | null) => void
  onMasterChange: (patch: Partial<Master>, merge?: string) => void
  onTrackChange: (id: string, patch: Partial<Track>, merge?: string) => void
  /** 続けての変更（ドラッグ、スライダー）の履歴のまとまりを切る */
  onEndMerge: () => void
  onDropFiles: (files: File[], at?: DropAt) => void
  onBlockChange: (id: string, patch: Partial<Block>, merge?: string) => void
  /** 波形ブロックの右クリック（画面の座標） */
  onBlockMenu: (id: string, x: number, y: number) => void
  /** 表示範囲（拡大縮小をキーからも変えるので App が持つ） */
  view: TimelineView
  /** 目盛りの線、波形ブロックの端、再生位置に吸い付けるか */
  snap: boolean
  onView: (fn: (v: TimelineView) => TimelineView) => void
}) {
  // theme.palette は常にライトの値なので、今の配色は usePalette で取る（Synth の docs/CODING.md）
  const { dark, pal } = usePalette()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { view } = p
  const setView = p.onView
  const [width, setWidth] = useState(0)
  const drag = useRef<Drag | null>(null)
  // 範囲選択のドラッグを始めた時刻と位置
  const rangeDrag = useRef<{ t: number; x: number } | null>(null)
  const dragCount = useRef(0)
  const [cursor, setCursor] = useState('default')
  const height = TOP + Math.max(1, p.project.tracks.length) * LANE

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
    // 色は WeVocalSynth の波形と同じ（波形は主の色、再生位置は文字の色、範囲選択はシアン）
    drawTimeline(canvas, p.project, view, p.selected, p.cursor, p.range, {
      bg: pal.background.default,
      lane: pal.divider,
      line: alpha(pal.divider, 0.5),
      text: pal.text.primary,
      block: alpha(pal.primary.main, dark ? 0.18 : 0.12),
      blockSelected: alpha(pal.primary.main, dark ? 0.36 : 0.26),
      wave: pal.primary.main,
      playhead: pal.text.primary,
      master: alpha(pal.text.primary, 0.04),
      range: alpha(dark ? SELECTION_DARK : SELECTION_LIGHT, 0.18),
    })
  }, [p.project, view, p.selected, p.cursor, p.range, width, height, dark, pal])

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
  }, [setView])

  const toTime = (x: number) => view.scroll + x / view.pps

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // 右クリックはメニュー（onContextMenu）だけ
    if (e.button === 2) return
    const { offsetX: x, offsetY: y } = e.nativeEvent
    const hit = y > TOP ? hitBlock(p.project, x, y, toTime, view.pps) : null
    if (!hit) {
      // 目盛りか空いている所: 押しただけなら再生位置、ドラッグしたら範囲選択
      p.onSelect(null)
      const track = p.project.tracks[Math.floor((y - TOP) / LANE)]
      if (track) p.onSelectTrack(track.id)
      p.onSeek(Math.max(0, toTime(x)))
      e.currentTarget.setPointerCapture(e.pointerId)
      rangeDrag.current = { t: Math.max(0, toTime(x)), x }
      return
    }
    p.onSelect(hit.block.id)
    p.onSelectTrack(hit.block.track)
    e.currentTarget.setPointerCapture(e.pointerId)
    const trackIndex = p.project.tracks.findIndex((t) => t.id === hit.block.track)
    drag.current = { kind: hit.kind, block: hit.block, x, y, trackIndex, merge: `drag${dragCount.current++}` }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { offsetX: x, offsetY: y } = e.nativeEvent
    const r = rangeDrag.current
    if (r) {
      if (Math.abs(x - r.x) < 3) return
      const t = Math.max(0, toTime(x))
      const snapped = p.snap && !e.shiftKey ? (snapTime(t, snapTargets(p.project, p.cursor, null), view.pps) ?? t) : t
      p.onRange({ start: Math.min(r.t, snapped), end: Math.max(r.t, snapped) })
      return
    }
    const d = drag.current
    if (!d) {
      // つまめる所でカーソルの形を変える
      const hit = y > TOP ? hitBlock(p.project, x, y, toTime, view.pps) : null
      setCursor(hit ? CURSOR[hit.kind] : 'default')
      return
    }
    // Shift を押している間は吸い付けない（REAPER と同じ）
    const raw = (x - d.x) / view.pps
    const dt = p.snap && !e.shiftKey ? snapDelta(d, raw, snapTargets(p.project, p.cursor, d.block.id), view.pps) : raw
    p.onBlockChange(d.block.id, dragPatch(p.project, d, dt, Math.round((y - d.y) / LANE)), d.merge)
  }

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // 範囲を作らずに離したら、範囲を消す（REAPER と同じ）
    if (rangeDrag.current && Math.abs(e.nativeEvent.offsetX - rangeDrag.current.x) < 3) p.onRange(null)
    rangeDrag.current = null
    drag.current = null
    p.onEndMerge()
  }

  // ファイルを落としたトラックと時刻に置く（トラックの外なら空いているトラックか新しいトラック）
  const onDrop = (e: React.DragEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    e.stopPropagation()
    const track = p.project.tracks[Math.floor((e.nativeEvent.offsetY - TOP) / LANE)]
    p.onDropFiles([...e.dataTransfer.files], track && { track: track.id, start: Math.max(0, toTime(e.nativeEvent.offsetX)) })
  }

  return (
    <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
    <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', alignItems: 'flex-start' }}>
      <Box sx={{ width: HEADER, flexShrink: 0, borderRight: 1, borderColor: 'divider' }}>
        <Box sx={{ height: RULER, borderBottom: 1, borderColor: 'divider', boxSizing: 'border-box' }} />
        <MasterHeader master={p.project.master} height={MASTER} onChange={p.onMasterChange} onEndMerge={p.onEndMerge} />
        {p.project.tracks.map((track) => (
          <TrackHeader
            key={track.id}
            track={track}
            height={LANE}
            selected={track.id === p.selectedTrack}
            onSelect={() => p.onSelectTrack(track.id)}
            onChange={(patch, merge) => p.onTrackChange(track.id, patch, merge)}
            onEndMerge={p.onEndMerge}
          />
        ))}
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <canvas
          ref={canvasRef}
          style={{ display: 'block', width, height, touchAction: 'none', cursor }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onContextMenu={(e) => {
            e.preventDefault()
            const { offsetX: x, offsetY: y } = e.nativeEvent
            const hit = y > TOP ? hitBlock(p.project, x, y, toTime, view.pps) : null
            if (!hit) return
            p.onSelect(hit.block.id)
            p.onSelectTrack(hit.block.track)
            p.onBlockMenu(hit.block.id, e.clientX, e.clientY)
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
        />
      </Box>
    </Box>
    </Box>
  )
}
