// 時間軸。左にトラックの欄、右に波形ブロックを並べた canvas。波形ブロックはドラッグで動かし（ほかのトラックへも移せる）、端で長さ、上の角でフェードを変える
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Box } from '@mui/material'
import { useEdgeScroll } from 'wevocal-lib/react'
import { SELECTION_DARK, SELECTION_LIGHT, alpha, type Range } from 'wevocal-lib'
import { usePalette } from 'pevenmui'
import type { GridMode } from './grid'
import { CURSOR, dragPatch, hitBlock, snapDelta, snapTargets, snapTime, type Drag } from './blockDrag'
import { LANE, MASTER, RULER, TOP, drawTimeline, type TimelineView } from './drawTimeline'
import type { Block, Master, Project, Track } from './project'
import TrackHeader, { MasterHeader } from './TrackHeader'
import type { DropAt } from './useProject'

/** 左のトラックの欄の幅（解析の欄もそろえる） */
export const HEADER = 200

export default function Timeline(p: {
  project: Project
  cursor: number
  selected: string[]
  onSelect: (ids: string[]) => void
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
  onBlocksChange: (patches: Record<string, Partial<Block>>, merge?: string) => void
  /** 波形ブロックの右クリック（画面の座標） */
  onBlockMenu: (id: string, x: number, y: number) => void
  /** 目盛りの上のマーカーをダブルクリック */
  onMarkerEdit: (id: string) => void
  /** 波形ブロックのダブルクリック（プロパティ） */
  onProperties: (id: string) => void
  /** トラックの EQ を開く */
  onEq: (track: string) => void
  onDuplicateTrack: (id: string) => void
  onRemoveTrack: (id: string) => void
  /** 表示範囲（拡大縮小をキーからも変えるので App が持つ） */
  view: TimelineView
  /** 目盛りの線、波形ブロックの端、再生位置に吸い付けるか */
  snap: boolean
  /** 再生中（再生位置が画面の外に出たら表示を送る） */
  playing: boolean
  /** 線の取り方（拍と小節か、秒） */
  grid: GridMode
  onView: (fn: (v: TimelineView) => TimelineView) => void
  /** 波形を描く所の幅（px。ミニマップの枠に使う） */
  onWidth: (w: number) => void
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
  // 目盛りの上で押している間は、再生位置が付いてくる（範囲選択にしない。WeVocalSynth と同じ）
  const scrub = useRef(false)
  // Shift+クリックの起点（前に押した波形ブロック）
  const anchor = useRef<string | null>(null)
  // 右ドラッグの枠で選ぶ（REAPER と同じ）。moved なら右クリックのメニューは出さない
  const marquee = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const dragCount = useRef(0)
  const [cursor, setCursor] = useState('default')
  const height = TOP + Math.max(1, p.project.tracks.length) * LANE

  // 幅を App に知らせる
  const { onWidth } = p
  useEffect(() => onWidth(width), [width, onWidth])

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
    drawTimeline(canvas, p.project, view, p.selected, p.cursor, p.range, { grid: p.grid }, {
      bg: pal.background.default,
      lane: pal.divider,
      line: alpha(pal.divider, 0.5),
      text: pal.text.primary,
      block: alpha(pal.primary.main, dark ? 0.18 : 0.12),
      blockSelected: alpha(pal.primary.main, dark ? 0.36 : 0.26),
      wave: pal.primary.main,
      playhead: pal.text.primary,
      master: alpha(pal.text.primary, 0.04),
      marker: '#ffb300',
      range: alpha(dark ? SELECTION_DARK : SELECTION_LIGHT, 0.18),
    })
  }, [p.project, view, p.selected, p.cursor, p.range, width, height, dark, pal, p.grid])

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
  // 目盛りのドラッグで端に来たら表示を流す（WeVocalSynth と同じ wevocal-lib の部品）。流せる先は曲の終わりの少し先まで
  const visible = width / view.pps
  const end = p.project.blocks.reduce((m, b) => Math.max(m, b.start + b.length), 0)
  const edge = useEdgeScroll({
    canvasRef,
    view: { start: view.scroll, dur: visible },
    duration: Math.max(end + visible, view.scroll + visible),
    setRange: (start) => setView((v) => ({ ...v, scroll: start })),
    seek: (t) => p.onSeek(Math.max(0, t)),
  })

  // 再生中に再生位置が画面の外に出たら、そこが左端になるように送る（REAPER と同じ）
  useEffect(() => {
    if (!p.playing || !visible) return
    if (p.cursor > view.scroll + visible || p.cursor < view.scroll) setView((v) => ({ ...v, scroll: Math.max(0, p.cursor) }))
  }, [p.playing, p.cursor, visible, view.scroll, setView])
  const snapping = { mode: p.grid, tempo: p.project.tempo, pps: view.pps }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // 時間軸を押したら、スライダーなどに残ったフォーカスを外す（キーが時間軸の操作に届くように）
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    const { offsetX: x, offsetY: y } = e.nativeEvent
    // 右ボタン: ドラッグすれば枠で選ぶ。動かさなければ右クリックのメニュー（onContextMenu）
    if (e.button === 2) {
      if (y > TOP) {
        e.currentTarget.setPointerCapture(e.pointerId)
        marquee.current = { x, y, moved: false }
      }
      return
    }
    const hit = y > TOP ? hitBlock(p.project, x, y, toTime, view.pps) : null
    if (y < RULER) {
      e.currentTarget.setPointerCapture(e.pointerId)
      scrub.current = true
      p.onSeek(Math.max(0, toTime(x)))
      return
    }
    if (!hit) {
      // 空いている所: 押しただけなら再生位置、ドラッグしたら範囲選択
      if (!e.ctrlKey && !e.metaKey) p.onSelect([])
      const track = p.project.tracks[Math.floor((y - TOP) / LANE)]
      if (track) p.onSelectTrack(track.id)
      p.onSeek(Math.max(0, toTime(x)))
      e.currentTarget.setPointerCapture(e.pointerId)
      rangeDrag.current = { t: Math.max(0, toTime(x)), x }
      return
    }
    const id = hit.block.id
    // Shift: 起点から押したものまでの、トラックと時間の範囲の波形ブロックを選ぶ
    const from = anchor.current && p.project.blocks.find((b) => b.id === anchor.current)
    if (e.shiftKey && from) {
      const row = (b: Block) => p.project.tracks.findIndex((t) => t.id === b.track)
      const [r0, r1] = [Math.min(row(from), row(hit.block)), Math.max(row(from), row(hit.block))]
      const t0 = Math.min(from.start, hit.block.start)
      const t1 = Math.max(from.start + from.length, hit.block.start + hit.block.length)
      p.onSelect(p.project.blocks.filter((b) => row(b) >= r0 && row(b) <= r1 && b.start < t1 && b.start + b.length > t0).map((b) => b.id))
      return
    }
    anchor.current = id
    // Ctrl で足し引き。選んでいるものをつまんだら、選んだもの全部を動かす
    let group = p.selected.includes(id) ? p.selected : [id]
    if (e.ctrlKey || e.metaKey) {
      group = p.selected.includes(id) ? p.selected.filter((s) => s !== id) : [...p.selected, id]
      p.onSelect(group)
      if (!group.includes(id)) return
    } else p.onSelect(group)
    p.onSelectTrack(hit.block.track)
    e.currentTarget.setPointerCapture(e.pointerId)
    const trackIndex = p.project.tracks.findIndex((t) => t.id === hit.block.track)
    const others = hit.kind === 'move' ? p.project.blocks.filter((b) => group.includes(b.id) && b.id !== id) : []
    drag.current = { kind: hit.kind, block: hit.block, others, x, y, trackIndex, merge: `drag${dragCount.current++}` }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { offsetX: x, offsetY: y } = e.nativeEvent
    const mq = marquee.current
    if (mq) {
      if (!mq.moved && Math.hypot(x - mq.x, y - mq.y) < 4) return
      mq.moved = true
      setBox({ x0: Math.min(mq.x, x), y0: Math.min(mq.y, y), x1: Math.max(mq.x, x), y1: Math.max(mq.y, y) })
      // 枠にかかる波形ブロックを選ぶ
      const ta = toTime(Math.min(mq.x, x))
      const tb = toTime(Math.max(mq.x, x))
      const ra = Math.floor((Math.min(mq.y, y) - TOP) / LANE)
      const rb = Math.floor((Math.max(mq.y, y) - TOP) / LANE)
      p.onSelect(p.project.blocks.filter((b) => { const r = p.project.tracks.findIndex((t) => t.id === b.track); return r >= ra && r <= rb && b.start < tb && b.start + b.length > ta }).map((b) => b.id))
      return
    }
    if (scrub.current) {
      edge.update(e.clientX)
      return p.onSeek(Math.max(0, toTime(x)))
    }
    const r = rangeDrag.current
    if (r) {
      if (Math.abs(x - r.x) < 3) return
      const t = Math.max(0, toTime(x))
      const snapped = p.snap && !e.shiftKey ? (snapTime(t, snapTargets(p.project, p.cursor, []), snapping) ?? t) : t
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
    const exclude = [d.block.id, ...d.others.map((b) => b.id)]
    let dt = p.snap && !e.shiftKey ? snapDelta(d, raw, snapTargets(p.project, p.cursor, exclude), snapping) : raw
    const di = Math.round((y - d.y) / LANE)
    // Alt を押しながら端をドラッグすると速度ごと伸び縮みする（REAPER と同じ）
    if (!d.others.length) return p.onBlockChange(d.block.id, dragPatch(p.project, d, dt, di, e.altKey), d.merge)
    // まとめて動かす。一番前のものが 0 より前に出ない所、トラックの外に出ない所で止める
    const all = [d.block, ...d.others]
    dt = Math.max(dt, -Math.min(...all.map((b) => b.start)))
    const rows = all.map((b) => p.project.tracks.findIndex((t) => t.id === b.track))
    const shift = Math.max(-Math.min(...rows), Math.min(p.project.tracks.length - 1 - Math.max(...rows), di))
    p.onBlocksChange(Object.fromEntries(all.map((b, i) => [b.id, { start: b.start + dt, track: p.project.tracks[rows[i] + shift].id }])), d.merge)
  }

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (marquee.current) {
      // 動かしたら、このあとの右クリックのメニューは出さない
      if (!marquee.current.moved) marquee.current = null
      setBox(null)
    }
    // 範囲を作らずに離したら、範囲を消す（REAPER と同じ）
    if (rangeDrag.current && Math.abs(e.nativeEvent.offsetX - rangeDrag.current.x) < 3) p.onRange(null)
    rangeDrag.current = null
    scrub.current = false
    edge.stop()
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
            onEq={() => p.onEq(track.id)}
            onDuplicate={() => p.onDuplicateTrack(track.id)}
            onRemove={() => p.onRemoveTrack(track.id)}
          />
        ))}
      </Box>
      <Box sx={{ flex: 1, minWidth: 0, position: 'relative' }}>
        {box && (
          <Box sx={{ position: 'absolute', left: box.x0, top: box.y0, width: box.x1 - box.x0, height: box.y1 - box.y0, border: 1, borderColor: 'primary.main', bgcolor: alpha(pal.primary.main, 0.12), pointerEvents: 'none' }} />
        )}
        <canvas
          ref={canvasRef}
          style={{ display: 'block', width, height, touchAction: 'none', cursor }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onDoubleClick={(e) => {
            const { offsetX: x, offsetY: y } = e.nativeEvent
            if (y > TOP) {
              const hit = hitBlock(p.project, x, y, toTime, view.pps)
              if (hit) p.onProperties(hit.block.id)
              return
            }
            if (y >= RULER) return
            // 旗の幅の中か、線の近く
            const m = p.project.markers.find((m) => { const mx = (m.time - view.scroll) * view.pps; return x >= mx - 4 && x <= mx + 60 })
            if (m) p.onMarkerEdit(m.id)
          }}
          onContextMenu={(e) => {
            e.preventDefault()
            if (marquee.current?.moved) {
              marquee.current = null
              return
            }
            marquee.current = null
            const { offsetX: x, offsetY: y } = e.nativeEvent
            const hit = y > TOP ? hitBlock(p.project, x, y, toTime, view.pps) : null
            if (!hit) return
            if (!p.selected.includes(hit.block.id)) p.onSelect([hit.block.id])
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
