// 時間軸の左のトラックの欄（マスターと各トラックの音量、パン、ミュート、ソロ、FX など）。欄の並べ替え（ドラッグ）と高さの変更もここで受ける。縦のスクロールは時間軸と同じだけずらす
import { useEffect, useRef, useState } from 'react'
import { useDoc } from '../DocContext'
import { Box, IconButton } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faAnglesLeft, faAnglesRight } from '@fortawesome/free-solid-svg-icons'
import { useT } from '../i18n'
import { depthOf, masterHeight, trackHeight, TRACK_HEIGHT_MAX, TRACK_HEIGHT_MIN } from '../project'
import { RULER, totalTrackHeight, trackTop } from '../drawTimeline'
import TrackHeader, { MasterHeader } from '../TrackHeader'
import type { TimelineProps } from '../Timeline'

export default function TrackColumn(c: { p: TimelineProps; vs: number; maxV: number; top: number; setVscroll: (v: number | ((v: number) => number)) => void; slotAt: (y: number) => number; resizeRef: { current: { id: string; y: number; height: number; merge: string } | null } }) {
  const { p, vs, maxV, top: TOP, setVscroll, slotAt, resizeRef: trackResizeRef } = c
  const doc = useDoc()
  const t = useT()
  const header = p.headerWidth
  // トラックのドラッグ並び替え
  const headerContainerRef = useRef<HTMLDivElement | null>(null)
  const trackDragRef = useRef<{ id: string } | null>(null)
  const [draggingTrackId, setDraggingTrackId] = useState<string | null>(null)
  const [dropSlot, setDropSlot] = useState<number | null>(null)
  const vsRef = useRef(0)
  vsRef.current = vs
  const slotAtRef = useRef(slotAt)
  slotAtRef.current = slotAt

  // 並び替え中は、どこにいても「つかんでいる手」にする（始める前は普通のカーソルのまま）
  useEffect(() => {
    if (!draggingTrackId) return
    const prev = document.body.style.cursor
    document.body.style.cursor = 'grabbing'
    return () => {
      document.body.style.cursor = prev
    }
  }, [draggingTrackId])

  // 並び替えのドラッグ中、欄の上下の端に近づいたら縦にスクロールする（落とす位置の線も追従）
  const dragYRef = useRef(0)
  const maxVRef = useRef(0)
  maxVRef.current = maxV
  useEffect(() => {
    if (!draggingTrackId) return
    const EDGE = 40
    let id = 0
    const tick = () => {
      const el = headerContainerRef.current
      if (el) {
        const rect = el.getBoundingClientRect()
        const y = dragYRef.current
        const speed = y < rect.top + EDGE ? -Math.min(1, (rect.top + EDGE - y) / EDGE) : y > rect.bottom - EDGE ? Math.min(1, (y - (rect.bottom - EDGE)) / EDGE) : 0
        if (speed) {
          const next = Math.max(0, Math.min(maxVRef.current, vsRef.current + speed * 14))
          if (next !== vsRef.current) {
            vsRef.current = next
            setVscroll(next)
            setDropSlot(slotAtRef.current(y - rect.top + next + TOP))
          }
        }
      }
      id = requestAnimationFrame(tick)
    }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
  }, [draggingTrackId])


  return (
    <Box sx={{ width: header, flexShrink: 0, borderRight: 1, borderColor: 'divider', display: 'flex', flexDirection: 'column', position: 'relative' }}>
      {p.headerBar}
      <Box sx={{ height: RULER, borderBottom: 1, borderColor: 'divider', boxSizing: 'border-box', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: p.headerCollapsed ? 'center' : 'flex-end', pr: p.headerCollapsed ? 0 : 0.5 }}>
        <IconButton size="small" aria-label={t(p.headerCollapsed ? 'track.openHeader' : 'track.closeHeader')} title={t(p.headerCollapsed ? 'track.openHeader' : 'track.closeHeader')} onClick={p.onToggleHeader} sx={{ p: 0.25 }}>
          <FontAwesomeIcon icon={p.headerCollapsed ? faAnglesRight : faAnglesLeft} size="xs" />
        </IconButton>
      </Box>
      {!p.headerCollapsed && <MasterHeader master={p.project.master} height={masterHeight(p.project.master)} onFx={() => p.onFx('master')} onChange={doc.updateMaster} onEndMerge={doc.endMerge} meter={p.masterMeter} />}
      {/* トラックの欄は、時間軸と同じだけ縦にずらす（ホイールでもスクロール） */}
      <Box
        hidden={p.headerCollapsed}
        ref={headerContainerRef as React.RefObject<HTMLDivElement>}
        sx={{ flex: 1, minHeight: 0, overflow: 'hidden', position: 'relative' }}
        onWheel={(e) => setVscroll((v) => Math.max(0, Math.min(maxV, v + e.deltaY)))}
        onPointerMove={(e) => {
          const resizing = trackResizeRef.current
          if (resizing) {
            doc.changeTrack(resizing.id, { height: Math.max(TRACK_HEIGHT_MIN, Math.min(TRACK_HEIGHT_MAX, resizing.height + e.clientY - resizing.y)) }, resizing.merge)
            return
          }
          if (!trackDragRef.current) return
          dragYRef.current = e.clientY
          const rect = e.currentTarget.getBoundingClientRect()
          // slotAt は時間軸と同じ座標（目盛りとマスターの分 TOP を含む）なので足す
          const y = e.clientY - rect.top + vsRef.current + TOP
          setDropSlot(slotAt(y))
        }}
        onPointerUp={() => {
          if (trackDragRef.current && dropSlot !== null) p.onMoveTrack(trackDragRef.current.id, dropSlot)
          if (trackResizeRef.current) doc.endMerge()
          trackResizeRef.current = null
          trackDragRef.current = null
          setDraggingTrackId(null)
          setDropSlot(null)
        }}
        onPointerCancel={() => { trackResizeRef.current = null; trackDragRef.current = null; setDraggingTrackId(null); setDropSlot(null) }}
      >
        <Box sx={{ transform: `translateY(${-vs}px)`, position: 'relative' }}>
          {/* ドロップ位置の線 */}
          {dropSlot !== null && (
            <Box sx={{ position: 'absolute', left: 0, right: 0, top: (dropSlot >= p.project.tracks.length ? totalTrackHeight(p.project) : trackTop(p.project, dropSlot) - TOP) - 1, height: 2, bgcolor: 'primary.main', zIndex: 10, pointerEvents: 'none' }} />
          )}
          {p.project.tracks.map((track) => {
            const i = p.project.tracks.findIndex((t) => t.id === track.id)
            return (
            <TrackHeader
              key={track.id}
              track={track}
              height={trackHeight(track)}
              selected={doc.selectedTracks.includes(track.id)}
              selectMode={p.selectMode}
              dragging={draggingTrackId === track.id}
              onReorderStart={(e) => {
                const el = headerContainerRef.current
                if (!el) return
                el.setPointerCapture(e.nativeEvent.pointerId)
                trackDragRef.current = { id: track.id }
                dragYRef.current = e.clientY
                setDraggingTrackId(track.id)
                setDropSlot(i)
              }}
              onResizeStart={(e) => {
                const el = headerContainerRef.current
                if (!el) return
                el.setPointerCapture(e.nativeEvent.pointerId)
                trackResizeRef.current = { id: track.id, y: e.clientY, height: trackHeight(track), merge: `track:${track.id}:height` }
              }}
              onSelect={(e) => {
                // トラックの欄を押したらトラックだけを選ぶ（Ctrl+C でトラックをコピーできるように）。
                // Ctrl で足し引き、Shift で前に選んだトラックからの範囲。選んでいるものを押したら選択はそのまま（まとめて音量を動かせるように）
                doc.select([])
                const ids = p.project.tracks.map((tr) => tr.id)
                const sel = doc.selectedTracks
                if (p.selectMode) {
                  doc.setRange(null)
                  doc.selectTracks(sel.includes(track.id) ? sel.filter((x) => x !== track.id) : [...sel, track.id])
                } else if (e.ctrlKey || e.metaKey) doc.selectTracks(sel.includes(track.id) ? sel.filter((x) => x !== track.id) : [...sel, track.id])
                else if (e.shiftKey && p.selectedTrack) {
                  const [i0, i1] = [ids.indexOf(p.selectedTrack), ids.indexOf(track.id)].sort((x, y) => x - y)
                  doc.selectTracks([...ids.slice(i0, i1 + 1).filter((x) => x !== p.selectedTrack), p.selectedTrack])
                } else if (!sel.includes(track.id)) p.onSelectTrack(track.id)
              }}
              onChange={(patch, merge) => doc.changeTrack(track.id, patch, merge)}
              onEndMerge={doc.endMerge}
              onFx={() => p.onFx(track.id)}
              meter={p.meter && (() => p.meter!(track.id))}
              depth={depthOf(p.tree, track)}
              hasChildren={p.tree.tracks.some((t) => t.parent === track.id)}
              onAddSubtrack={() => p.onTrackOp('addSubtrack', track.id)}
              onIndent={() => p.onTrackOp('indent', track.id)}
              onOutdent={() => p.onTrackOp('outdent', track.id)}
              onMoveUp={() => i > 0 && p.onMoveTrack(track.id, i - 1)}
              onMoveDown={() => i < p.project.tracks.length - 1 && p.onMoveTrack(track.id, i + 2)}
              onDuplicate={() => doc.duplicateTrack(track.id)}
              onFreeze={(withFx) => p.onFreezeTrack(track.id, withFx)}
              onSends={() => p.onSends(track.id)}
              onProperties={() => p.onTrackProperties(doc.selectedTracks.includes(track.id) ? doc.selectedTracks : [track.id])}
              onRemove={() => p.onRemoveTrack(track.id)}
            />
          )})}
        </Box>
      </Box>
    </Box>
  )
}
