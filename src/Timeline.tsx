// 時間軸。左にトラックの欄、右に波形ブロックを並べた canvas。波形ブロックはドラッグで動かし（ほかのトラックへも移せる）、端で長さ、上の角でフェードを変える
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Box } from '@mui/material'
import { useEdgeScroll } from 'wevocal-lib/react'
import { SELECTION_DARK, SELECTION_LIGHT, alpha, type Range } from 'wevocal-lib'
import { usePalette } from 'pevenmui'
import { layoutRows } from './overlap'
import { ENV_MAX, ENV_MIN, depthOf } from './project'
import { snapGrid, type GridDivision, type GridMode } from './grid'
import { CURSOR, dragPatch, envDb, hitBlock, hitEnvPoint, slipPatch, snapDelta, snapTargets, type Drag } from './blockDrag'
import { LANE, MASTER, RULER, TOP, drawCursors, drawTimeline, type TimelineView } from './drawTimeline'
import type { Block, Master, Project, Track } from './project'
import TrackHeader, { MasterHeader } from './TrackHeader'
import type { DropAt } from './useProject'

/** 左のトラックの欄の幅（解析の欄もそろえる） */
export const HEADER = 200

export default function Timeline(p: {
  project: Project
  /** 編集カーソル */
  cursor: number
  /** 再生カーソルの今の位置（再生中と一時停止中だけ。再生中は毎フレーム読む） */
  livePos: () => number | null
  /** 再生位置に表示を追従させる */
  follow: boolean
  /** 編集カーソルだけを動かす（波形ブロックを押したとき） */
  onCursor: (t: number) => void
  selected: string[]
  /** merge が同じなら履歴の 1 段にまとめる（枠でのドラッグ） */
  onSelect: (ids: string[], merge?: string) => void
  selectedTrack: string | null
  onSelectTrack: (id: string) => void
  /** 選んでいるトラック（複数） */
  selectedTracks: string[]
  onSelectTracks: (ids: string[]) => void
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
  /** 何もない所の右クリック（目盛りか、トラックの空いている所）。time はグリッドに合わせた時刻 */
  onEmptyMenu: (kind: 'lane' | 'ruler', time: number, track: string | null, x: number, y: number) => void
  /** Ctrl+ドラッグで、写しをその場に残す */
  onCopyBlocks: (blocks: Block[]) => void
  /** 目盛りの上のマーカーをダブルクリック */
  onMarkerEdit: (id: string) => void
  /** 波形ブロックのダブルクリック（プロパティ） */
  onProperties: (id: string) => void
  /** トラックの EQ を開く */
  onEq: (track: string) => void
  /** レベルメーター（出さなければ省く） */
  meter?: (trackId: string) => readonly AnalyserNode[] | null
  masterMeter?: () => readonly AnalyserNode[] | null
  onDuplicateTrack: (id: string) => void
  /** サブトラックの操作 */
  onTrackOp: (op: 'addSubtrack' | 'indent' | 'outdent', id: string) => void
  /** 隠したトラックも含む、全部のトラック（階層を調べる。project は見えているトラックだけ） */
  tree: Project
  onRemoveTrack: (id: string) => void
  /** 表示範囲（拡大縮小をキーからも変えるので App が持つ） */
  view: TimelineView
  /** 目盛りの線、波形ブロックの端、再生位置に吸い付けるか */
  snap: boolean
  /** 再生中（カーソルの線を毎フレーム描き直す） */
  playing: boolean
  /** 線の取り方（拍と小節か、秒） */
  grid: GridMode
  /** グリッドの細かさ */
  division: GridDivision
  /** 音量のエンベロープを描いて編集する */
  envelope: boolean
  onView: (fn: (v: TimelineView) => TimelineView) => void
  /** 波形を描く所の幅（px。ミニマップの枠に使う） */
  onWidth: (w: number) => void
  /** かたまりができるたびに増える（「処理中」を描き直す） */
  madeVersion: number
  /** 作り直している波形ブロックに出す文字（「処理中」） */
  pendingLabel: string
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
  // エンベロープの点をドラッグしている所
  const envDrag = useRef<{ block: string; index: number; merge: string } | null>(null)
  // Shift+クリックの起点（前に押した波形ブロック）
  const anchor = useRef<string | null>(null)
  // 右ドラッグの枠で選ぶ。moved なら右クリックのメニューは出さない
  const marquee = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const dragCount = useRef(0)
  const [cursor, setCursor] = useState('default')
  // 縦のスクロール。canvas は見える高さに固定し、トラックの行だけをずらす（目盛りとマスターは上に固定）
  const [vh, setVh] = useState(0)
  const [vscroll, setVscroll] = useState(0)
  const content = TOP + Math.max(1, p.project.tracks.length) * LANE
  const maxV = Math.max(0, content - vh)
  const vs = Math.min(vscroll, maxV)
  const height = Math.max(TOP + LANE, vh)
  /** 画面の y を、トラックの行の位置（スクロールを足したもの）にする。目盛りとマスターの所はそのまま */
  const cy = (y: number) => (y < TOP ? y : y + vs)

  // 幅を App に知らせる
  const { onWidth } = p
  useEffect(() => onWidth(width), [width, onWidth])

  // 幅に合わせる
  useLayoutEffect(() => {
    const box = canvasRef.current!.parentElement!
    const ro = new ResizeObserver(() => {
      setWidth(box.clientWidth)
      setVh(box.clientHeight)
    })
    ro.observe(box)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current!
    canvas.width = width * devicePixelRatio
    canvas.height = height * devicePixelRatio
    // 色は WeVocalSynth の波形と同じ（波形は主の色、再生位置は文字の色、範囲選択はシアン）
    drawTimeline(canvas, p.project, view, p.selected, p.range, { grid: p.grid, division: p.division, pendingLabel: p.pendingLabel, showEnvelope: p.envelope, vscroll: vs }, {
      bg: pal.background.default,
      lane: pal.divider,
      line: alpha(pal.divider, 0.5),
      text: pal.text.primary,
      block: alpha(pal.primary.main, dark ? 0.18 : 0.12),
      blockSelected: alpha(pal.primary.main, dark ? 0.36 : 0.26),
      wave: pal.primary.main,
      playhead: pal.text.primary,
      editCursor: '#e53935',
      master: alpha(pal.text.primary, 0.04),
      marker: '#ffb300',
      range: alpha(dark ? SELECTION_DARK : SELECTION_LIGHT, 0.18),
    })
  }, [p.project, view, p.selected, p.range, width, height, dark, pal, p.grid, p.division, p.madeVersion, p.pendingLabel, p.envelope, vs])

  // カーソルの線は上に重ねた canvas に描く。再生中は毎フレーム、再生位置を自分で読んでこれだけを描き直す（画面全体を描き直さない）
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const followRef = useRef({ follow: p.follow, visible: 0, scroll: 0 })
  followRef.current = { follow: p.follow, visible: width / view.pps, scroll: view.scroll }
  useEffect(() => {
    const canvas = overlayRef.current!
    canvas.width = width * devicePixelRatio
    canvas.height = height * devicePixelRatio
    const colors = { editCursor: '#e53935', playhead: pal.text.primary }
    const draw = () => drawCursors(canvas, view, p.cursor, p.livePos(), colors)
    draw()
    if (!p.playing) return
    let id = 0
    const tick = () => {
      draw()
      // 再生位置が画面の外に出たら、そこが左端になるように送る
      const pos = p.livePos()
      const f = followRef.current
      if (f.follow && pos !== null && f.visible && (pos > f.scroll + f.visible || pos < f.scroll)) setView((v) => ({ ...v, scroll: Math.max(0, pos) }))
      id = requestAnimationFrame(tick)
    }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
  }, [p.playing, p.cursor, p.livePos, view, width, height, pal, setView])

  // ホイール: Shift で横に動かす。Ctrl で拡大と縮小（マウスの位置を中心に）
  useEffect(() => {
    const canvas = canvasRef.current!
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      // 何も押していなければ縦にスクロール
      if (!e.ctrlKey && !e.shiftKey && !e.deltaX) return setVscroll((v) => Math.max(0, Math.min(maxRef.current, v + e.deltaY)))
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
  const maxRef = useRef(0)
  maxRef.current = maxV

  const toTime = (x: number) => view.scroll + x / view.pps
  /** 波形ブロックの画面の上の位置（重なって段に分けたときはその段。エンベロープの線を描く所と同じ） */
  const blockGeom = (b: Block) => {
    const row = p.project.tracks.findIndex((t) => t.id === b.track)
    const slot = layoutRows(p.project.blocks.filter((x) => x.track === b.track)).get(b.id) ?? { row: 0, rows: 1 }
    const H = LANE / slot.rows
    return { x: (b.start - view.scroll) * view.pps, top: TOP + row * LANE + slot.row * H + 2 - vs, h: H - 5 }
  }
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

  const snapping = { mode: p.grid, division: p.division, tempo: p.project.tempo, markers: p.project.markers, pps: view.pps }
  /** 編集カーソルと範囲選択の端は、スナップが入っていればいちばん近いグリッドの線に合わせる（Shift で外す） */
  const gridAt = (x: number, shift: boolean) => {
    const t = Math.max(0, toTime(x))
    if (!p.snap || shift) return t
    const { origin, step } = snapGrid(p.grid, p.project.tempo, view.pps, p.division, p.project.markers, t)
    return Math.max(0, origin + Math.round((t - origin) / step) * step)
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // 時間軸を押したら、スライダーなどに残ったフォーカスを外す（キーが時間軸の操作に届くように）
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    const { offsetX: x } = e.nativeEvent
    const y = cy(e.nativeEvent.offsetY)
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
      p.onSeek(gridAt(x, e.shiftKey))
      return
    }
    if (!hit) {
      // 空いている所: 押しただけなら再生位置、ドラッグしたら範囲選択
      if (!e.ctrlKey && !e.metaKey) p.onSelect([])
      const track = p.project.tracks[Math.floor((y - TOP) / LANE)]
      if (track) p.onSelectTrack(track.id)
      p.onSeek(gridAt(x, e.shiftKey))
      e.currentTarget.setPointerCapture(e.pointerId)
      rangeDrag.current = { t: gridAt(x, e.shiftKey), x }
      return
    }
    const id = hit.block.id
    // エンベロープを出しているときは、点を足すか動かす
    if (p.envelope && !e.altKey) {
      const b = hit.block
      const g = blockGeom(b)
      const env = [...(b.envelope ?? [])]
      let index = hitEnvPoint(b, x, y, g.x, g.top, g.h, view.pps)
      if (index < 0) {
        const t = Math.max(0, Math.min(b.length, (x - g.x) / view.pps))
        const db = Math.round(envDb((y - g.top) / g.h) * 10) / 10
        index = env.filter((pt) => pt.t <= t).length
        env.splice(index, 0, { t, db })
        p.onBlockChange(b.id, { envelope: env }, `env${dragCount.current}`)
      }
      p.onSelect([b.id])
      e.currentTarget.setPointerCapture(e.pointerId)
      envDrag.current = { block: b.id, index, merge: `env${dragCount.current++}` }
      return
    }
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
    // 押した所に再生位置を移す。端（長さを変える所）ならその端
    if (!e.ctrlKey && !e.metaKey) {
      const b = hit.block
      const t = hit.kind === 'left' || hit.kind === 'fadeIn' ? b.start : hit.kind === 'right' || hit.kind === 'fadeOut' ? b.start + b.length : toTime(x)
      const snapped = hit.kind === 'move' ? gridAt(x, e.shiftKey) : t
      p.onCursor(Math.max(0, snapped))
    }
    // 選んでいるものをつまんだら、選んだもの全部を動かす。Ctrl は、動かせば複製、動かさずに離せば選択の足し引き
    const ctrl = e.ctrlKey || e.metaKey
    const wasSelected = p.selected.includes(id)
    const group = wasSelected ? p.selected : ctrl ? [...p.selected, id] : [id]
    p.onSelect(group)
    p.onSelectTrack(hit.block.track)
    e.currentTarget.setPointerCapture(e.pointerId)
    const trackIndex = p.project.tracks.findIndex((t) => t.id === hit.block.track)
    const others = hit.kind === 'move' ? p.project.blocks.filter((b) => group.includes(b.id) && b.id !== id) : []
    drag.current = { kind: hit.kind, block: hit.block, others, x, y, trackIndex, merge: `drag${dragCount.current++}`, copy: ctrl && hit.kind === 'move' ? { wasSelected, done: false } : undefined }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { offsetX: x } = e.nativeEvent
    const y = cy(e.nativeEvent.offsetY)
    const ed = envDrag.current
    if (ed) {
      const b = p.project.blocks.find((x) => x.id === ed.block)
      if (!b?.envelope) return
      const g = blockGeom(b)
      const env = [...b.envelope]
      // 前後の点は越えない
      const lo = env[ed.index - 1]?.t ?? 0
      const hi = env[ed.index + 1]?.t ?? b.length
      env[ed.index] = { t: Math.max(lo, Math.min(hi, (x - g.x) / view.pps)), db: Math.round(Math.max(ENV_MIN, Math.min(ENV_MAX, envDb((y - g.top) / g.h))) * 10) / 10 }
      return p.onBlockChange(b.id, { envelope: env }, ed.merge)
    }
    const mq = marquee.current
    if (mq) {
      if (!mq.moved && Math.hypot(x - mq.x, y - mq.y) < 4) return
      mq.moved = true
      // 枠の表示は画面の位置（スクロールした分を引く）
      const sy = (v: number) => (v >= TOP ? v - vs : v)
      setBox({ x0: Math.min(mq.x, x), y0: sy(Math.min(mq.y, y)), x1: Math.max(mq.x, x), y1: sy(Math.max(mq.y, y)) })
      // 枠にかかる波形ブロックを選ぶ
      const ta = toTime(Math.min(mq.x, x))
      const tb = toTime(Math.max(mq.x, x))
      const ra = Math.floor((Math.min(mq.y, y) - TOP) / LANE)
      const rb = Math.floor((Math.max(mq.y, y) - TOP) / LANE)
      p.onSelect(
        p.project.blocks.filter((b) => { const r = p.project.tracks.findIndex((t) => t.id === b.track); return r >= ra && r <= rb && b.start < tb && b.start + b.length > ta }).map((b) => b.id),
        `marquee${mq.x},${mq.y}`,
      )
      return
    }
    if (scrub.current) {
      edge.update(e.clientX)
      return p.onSeek(gridAt(x, e.shiftKey))
    }
    const r = rangeDrag.current
    if (r) {
      if (Math.abs(x - r.x) < 3) return
      const snapped = gridAt(x, e.shiftKey)
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
    // Ctrl で始めたら、動かし始めたときに写しをその場に残す（動かすのは元のもの）
    if (d.copy && !d.copy.done) {
      if (Math.hypot(x - d.x, y - d.y) < 4) return
      d.copy.done = true
      p.onCopyBlocks([d.block, ...d.others])
    }
    // Shift を押している間は吸い付けない
    const raw = (x - d.x) / view.pps
    const exclude = [d.block.id, ...d.others.map((b) => b.id)]
    // Alt で本体をつまんだら、中の音だけをずらす（吸い付けない）
    if (e.altKey && d.kind === 'move') {
      const all = [d.block, ...d.others]
      return p.onBlocksChange(Object.fromEntries(all.map((b) => [b.id, slipPatch(p.project, b, raw)])), d.merge)
    }
    let dt = p.snap && !e.shiftKey ? snapDelta(d, raw, snapTargets(p.project, p.cursor, exclude), snapping) : raw
    const di = Math.round((y - d.y) / LANE)
    // Alt を押しながら端をドラッグすると速度ごと伸び縮みする
    if (!d.others.length) return p.onBlockChange(d.block.id, dragPatch(p.project, d, dt, di, e.altKey), d.merge)
    // まとめて動かす。一番前のものが 0 より前に出ない所、トラックの外に出ない所で止める
    const all = [d.block, ...d.others]
    dt = Math.max(dt, -Math.min(...all.map((b) => b.start)))
    const rows = all.map((b) => p.project.tracks.findIndex((t) => t.id === b.track))
    const shift = Math.max(-Math.min(...rows), Math.min(p.project.tracks.length - 1 - Math.max(...rows), di))
    p.onBlocksChange(Object.fromEntries(all.map((b, i) => [b.id, { start: b.start + dt, track: p.project.tracks[rows[i] + shift].id }])), d.merge)
  }

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    envDrag.current = null
    if (marquee.current) {
      // 動かしたら、このあとの右クリックのメニューは出さない
      if (!marquee.current.moved) marquee.current = null
      setBox(null)
    }
    // 範囲を作らずに離したら、範囲を消す
    if (rangeDrag.current && Math.abs(e.nativeEvent.offsetX - rangeDrag.current.x) < 3) p.onRange(null)
    // Ctrl で押して動かさずに離したら、選択の足し引き（選んでいたものは外す）
    const d = drag.current
    if (d?.copy && !d.copy.done && d.copy.wasSelected) p.onSelect(p.selected.filter((s) => s !== d.block.id))
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
    const track = p.project.tracks[Math.floor((cy(e.nativeEvent.offsetY) - TOP) / LANE)]
    p.onDropFiles([...e.dataTransfer.files], track && { track: track.id, start: Math.max(0, toTime(e.nativeEvent.offsetX)) })
  }

  return (
    <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
    <Box sx={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex' }}>
      <Box sx={{ width: HEADER, flexShrink: 0, borderRight: 1, borderColor: 'divider', display: 'flex', flexDirection: 'column' }}>
        <Box sx={{ height: RULER, borderBottom: 1, borderColor: 'divider', boxSizing: 'border-box', flexShrink: 0 }} />
        <MasterHeader master={p.project.master} height={MASTER} onChange={p.onMasterChange} onEndMerge={p.onEndMerge} meter={p.masterMeter} />
        {/* トラックの欄は、時間軸と同じだけ縦にずらす（ホイールでもスクロール） */}
        <Box sx={{ flex: 1, minHeight: 0, overflow: 'hidden' }} onWheel={(e) => setVscroll((v) => Math.max(0, Math.min(maxV, v + e.deltaY)))}>
        <Box sx={{ transform: `translateY(${-vs}px)` }}>
        {p.project.tracks.map((track) => (
          <TrackHeader
            key={track.id}
            track={track}
            height={LANE}
            selected={p.selectedTracks.includes(track.id)}
            onSelect={(e) => {
              // トラックの欄を押したらトラックだけを選ぶ（Ctrl+C でトラックをコピーできるように）。
              // Ctrl で足し引き、Shift で前に選んだトラックからの範囲。選んでいるものを押したら選択はそのまま（まとめて音量を動かせるように）
              p.onSelect([])
              const ids = p.project.tracks.map((tr) => tr.id)
              const sel = p.selectedTracks
              if (e.ctrlKey || e.metaKey) p.onSelectTracks(sel.includes(track.id) ? sel.filter((x) => x !== track.id) : [...sel, track.id])
              else if (e.shiftKey && p.selectedTrack) {
                const [i0, i1] = [ids.indexOf(p.selectedTrack), ids.indexOf(track.id)].sort((x, y) => x - y)
                p.onSelectTracks([...ids.slice(i0, i1 + 1).filter((x) => x !== p.selectedTrack), p.selectedTrack])
              } else if (!sel.includes(track.id)) p.onSelectTrack(track.id)
            }}
            onChange={(patch, merge) => p.onTrackChange(track.id, patch, merge)}
            onEndMerge={p.onEndMerge}
            onEq={() => p.onEq(track.id)}
            meter={p.meter && (() => p.meter!(track.id))}
            depth={depthOf(p.tree, track)}
            hasChildren={p.tree.tracks.some((t) => t.parent === track.id)}
            onAddSubtrack={() => p.onTrackOp('addSubtrack', track.id)}
            onIndent={() => p.onTrackOp('indent', track.id)}
            onOutdent={() => p.onTrackOp('outdent', track.id)}
            onDuplicate={() => p.onDuplicateTrack(track.id)}
            onRemove={() => p.onRemoveTrack(track.id)}
          />
        ))}
        </Box>
        </Box>
      </Box>
      <Box sx={{ flex: 1, minWidth: 0, position: 'relative' }}>
        {box && (
          <Box sx={{ position: 'absolute', left: box.x0, top: box.y0, width: box.x1 - box.x0, height: box.y1 - box.y0, border: 1, borderColor: 'primary.main', bgcolor: alpha(pal.primary.main, 0.12), pointerEvents: 'none' }} />
        )}
        {/* カーソルの線だけを描く canvas（押す操作は下の canvas が受ける） */}
        <canvas ref={overlayRef} style={{ position: 'absolute', left: 0, top: 0, width, height, pointerEvents: 'none' }} />
        <canvas
          ref={canvasRef}
          style={{ display: 'block', width, height, touchAction: 'none', cursor }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onDoubleClick={(e) => {
            const { offsetX: x } = e.nativeEvent
            const y = cy(e.nativeEvent.offsetY)
            if (y > TOP) {
              const hit = hitBlock(p.project, x, y, toTime, view.pps)
              if (!hit) return
              // エンベロープの点のダブルクリックは、その点を消す
              if (p.envelope) {
                const g = blockGeom(hit.block)
                const i = hitEnvPoint(hit.block, x, y, g.x, g.top, g.h, view.pps)
                if (i >= 0) return p.onBlockChange(hit.block.id, { envelope: hit.block.envelope!.filter((_, k) => k !== i) })
              }
              p.onProperties(hit.block.id)
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
            const { offsetX: x } = e.nativeEvent
            const y = cy(e.nativeEvent.offsetY)
            const hit = y > TOP ? hitBlock(p.project, x, y, toTime, view.pps) : null
            if (!hit) {
              const track = y > TOP ? (p.project.tracks[Math.floor((y - TOP) / LANE)]?.id ?? null) : null
              if (track) p.onSelectTrack(track)
              return p.onEmptyMenu(y < RULER ? 'ruler' : 'lane', gridAt(x, e.shiftKey), track, e.clientX, e.clientY)
            }
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
