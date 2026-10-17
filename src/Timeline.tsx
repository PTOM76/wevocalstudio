// 時間軸。左にトラックの欄、右に波形ブロックを並べた canvas。波形ブロックはドラッグで動かし（ほかのトラックへも移せる）、端で長さ、上の角でフェードを変える
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Box } from '@mui/material'
import { useEdgeScroll, useTouchGestures } from 'wevocal-lib/react'
import { SELECTION_DARK, SELECTION_LIGHT, alpha, fracToParam, type AutoPoint, type Range } from 'wevocal-lib'
import { ScrollBar, useDoubleTap, useBoxSize, useLongPress, useMobileLayout, usePalette } from 'pevenmui'
import { allLanes, hitAutoPoint, laneAt } from './autoLane'
import { hitMidi, type MidiDragKind } from './midiBlocks'
import { layoutRows } from './overlap'
import { depthOf, projectEnd, songEnd, trackHeight, TRACK_HEIGHT_DEFAULT, TRACK_HEIGHT_MAX, TRACK_HEIGHT_MIN } from './project'
import { ENVELOPES, hitEnvPoint, type EnvKind } from './envelopes'
import { snapGrid, type GridDivision, type GridMode } from './grid'
import { CURSOR, dragPatch, hitBlock, slipPatch, snapDelta, snapTargets, type Drag } from './blockDrag'
import { MASTER, RULER, TOP, drawCursors, drawTimeline, totalTrackHeight, trackTop, type LiveBlock, type TimelineView } from './drawTimeline'
import type { Block, Master, MidiBlock, Project, Track } from './project'
import TrackHeader, { MasterHeader } from './TrackHeader'
import type { DropAt } from './useProject'

/** 左のトラックの欄の幅（解析の欄もそろえる） */
/** トラックの欄の幅（スマホは時間軸を広く取るため狭くする） */
export const useHeaderWidth = () => (useMobileLayout() ? 136 : 200)

/**
 * 時間軸（canvas）の中の座標。clientX、clientY から求める（offsetX、offsetY は、画面の拡大（CSS の zoom）や、iPad のタッチで、描いている座標とずれることがある）。
 * 見えている大きさ（getBoundingClientRect）と、描いている大きさの比で換算するので、拡大していても合う
 */
function localPos(canvas: HTMLCanvasElement, e: { clientX: number; clientY: number }) {
  const r = canvas.getBoundingClientRect()
  const w = canvas.width / devicePixelRatio
  const h = canvas.height / devicePixelRatio
  return { x: ((e.clientX - r.left) * w) / (r.width || w), y: ((e.clientY - r.top) * h) / (r.height || h) }
}

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
  onEmptyMenu: (kind: 'lane' | 'ruler', time: number, track: string | null, x: number, y: number, marker?: string) => void
  /** Ctrl+ドラッグで、写しをその場に残す */
  onCopyBlocks: (blocks: Block[]) => void
  /** 目盛りの上のマーカーをダブルクリック */
  onMarkerEdit: (id: string) => void
  /** 波形ブロックのダブルクリック（プロパティ） */
  onProperties: (id: string) => void
  /** トラックの FX の列を開く（マスターは 'master'） */
  onFx: (track: string) => void
  /** レベルメーター（出さなければ省く） */
  meter?: (trackId: string) => readonly AnalyserNode[] | null
  masterMeter?: () => readonly AnalyserNode[] | null
  onDuplicateTrack: (id: string) => void
  onFreezeTrack: (id: string) => void
  /** トラックのセンドを開く */
  onSends: (id: string) => void
  /** サブトラックの操作 */
  onTrackOp: (op: 'addSubtrack' | 'indent' | 'outdent', id: string) => void
  /** トラックをスロット to（0〜N）へ並び替える */
  onMoveTrack: (id: string, to: number) => void
  /** 隠したトラックも含む、全部のトラック（階層を調べる。project は見えているトラックだけ） */
  tree: Project
  onRemoveTrack: (id: string) => void
  /** 表示範囲（拡大縮小をキーからも変えるので App が持つ） */
  view: TimelineView
  /** 目盛りの線、波形ブロックの端、再生位置に吸い付けるか */
  snap: boolean
  /** 再生中（カーソルの線を毎フレーム描き直す） */
  playing: boolean
  /** 録音中（録っている波形ブロックを毎フレーム描き直す） */
  recording: boolean
  /** 録っている最中の波形ブロックの様子（録っていなければ null） */
  live: () => { track: string; start: number; seconds: number; bars: readonly (readonly [number, number])[] } | null
  /** 線の取り方（拍と小節か、秒） */
  grid: GridMode
  /** グリッドの細かさ */
  division: GridDivision
  /** 音量のエンベロープを描いて編集する */
  /** 編集するエンベロープ（音量かピッチ。出さなければ null） */
  envKind: EnvKind | null
  /** オートメーションを編集する（FX のダイアログで選んだつまみのレーンの点を、足す、動かす、消す） */
  autoEdit: boolean
  /** オートメーションの点を変えた（トラックの id か 'master'、FX の項目、つまみ、点。merge はドラッグ中にまとめる履歴のキー） */
  onAutoChange: (target: string, slot: number, param: string, points: AutoPoint[], merge?: string) => void
  /** MIDI ブロックを動かした、長さを変えた（merge はドラッグ中にまとめる履歴のキー） */
  onMidiChange: (id: string, patch: Partial<MidiBlock>, merge?: string) => void
  /** MIDI ブロックのダブルクリック（ピアノロールを開く） */
  onMidiEdit: (id: string) => void
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
  // 描く場所の大きさ（変わった同じフレームで更新する。PevenMUI の useBoxSize）
  const boxRef = useRef<HTMLDivElement>(null)
  const { width, height: vh } = useBoxSize(boxRef)
  const drag = useRef<Drag | null>(null)
  // 範囲選択のドラッグを始めた時刻と位置
  const rangeDrag = useRef<{ t: number; x: number } | null>(null)
  // 目盛りの上で押している間は、再生位置が付いてくる（範囲選択にしない。WeVocalSynth と同じ）
  const scrub = useRef(false)
  // エンベロープの点をドラッグしている所
  const envDrag = useRef<{ block: string; index: number; merge: string } | null>(null)
  // ドラッグしているオートメーションの点（レーンの target と点の番号）
  const autoDrag = useRef<{ target: string; index: number; merge: string } | null>(null)
  // ドラッグしている MIDI ブロック（つかんだ所の、ブロックの左端からの px）
  const midiDrag = useRef<{ id: string; kind: MidiDragKind; grabPx: number; merge: string } | null>(null)
  // Shift+クリックの起点（前に押した波形ブロック）
  const anchor = useRef<string | null>(null)
  // 右ドラッグの枠で選ぶ。moved なら右クリックのメニューは出さない
  const marquee = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const dragCount = useRef(0)
  const [cursor, setCursor] = useState('default')
  // 縦のスクロール。canvas は見える高さに固定し、トラックの行だけをずらす（目盛りとマスターは上に固定）
  const [vscroll, setVscroll] = useState(0)
  const content = TOP + Math.max(TRACK_HEIGHT_DEFAULT, totalTrackHeight(p.project))
  const maxV = Math.max(0, content - vh)
  const vs = Math.min(vscroll, maxV)
  const height = Math.max(TOP + TRACK_HEIGHT_DEFAULT, vh)
  /** 画面の y を、トラックの行の位置（スクロールを足したもの）にする。目盛りとマスターの所はそのまま */
  // 見えている時間の長さ（横のスクロールバー）
  const visibleSec = width / view.pps
  const cy = (y: number) => (y < TOP ? y : y + vs)
  const trackAt = (y: number) => p.project.tracks.find((_, i) => y >= trackTop(p.project, i) && y < trackTop(p.project, i) + trackHeight(p.project.tracks[i]))
  const trackIndexAt = (y: number) => p.project.tracks.findIndex((_, i) => y >= trackTop(p.project, i) && y < trackTop(p.project, i) + trackHeight(p.project.tracks[i]))
  const rowDelta = (from: number, to: number) => {
    const a = trackIndexAt(from)
    const b = trackIndexAt(Math.max(TOP, to))
    return a < 0 || b < 0 ? 0 : b - a
  }
  const slotAt = (y: number) => {
    const center = Math.max(TOP, y)
    let best = p.project.tracks.length
    for (let i = 0; i < p.project.tracks.length; i++) {
      const mid = trackTop(p.project, i) + trackHeight(p.project.tracks[i]) / 2
      if (center < mid) return i
      best = i + 1
    }
    return best
  }

  // トラックのドラッグ並び替え
  const headerContainerRef = useRef<HTMLDivElement | null>(null)
  const trackDragRef = useRef<{ id: string } | null>(null)
  const trackResizeRef = useRef<{ id: string; y: number; height: number; merge: string } | null>(null)
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

  // 幅を App に知らせる
  const { onWidth } = p
  useEffect(() => onWidth(width), [width, onWidth])

  useLayoutEffect(() => {
    const canvas = canvasRef.current!
    canvas.width = width * devicePixelRatio
    canvas.height = height * devicePixelRatio
    // 色は WeVocalSynth の波形と同じ（波形は主の色、再生位置は文字の色、範囲選択はシアン）
    drawTimeline(
      canvas,
      p.project,
      view,
      p.selected,
      p.range,
      { grid: p.grid, division: p.division, pendingLabel: p.pendingLabel, envKind: p.envKind, autoEdit: p.autoEdit, vscroll: vs },
      {
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
      },
    )
  }, [p.project, view, p.selected, p.range, width, height, dark, pal, p.grid, p.division, p.madeVersion, p.pendingLabel, p.envKind, p.autoEdit, vs])

  // カーソルの線は上に重ねた canvas に描く。再生中は毎フレーム、再生位置を自分で読んでこれだけを描き直す（画面全体を描き直さない）
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const liveRef = useRef(p.live)
  liveRef.current = p.live
  const followRef = useRef({ follow: p.follow, visible: 0, scroll: 0 })
  followRef.current = { follow: p.follow, visible: width / view.pps, scroll: view.scroll }
  useLayoutEffect(() => {
    const canvas = overlayRef.current!
    canvas.width = width * devicePixelRatio
    canvas.height = height * devicePixelRatio
    const colors = { editCursor: '#e53935', playhead: pal.text.primary }
    // 録音中の波形ブロック（録っているトラックの行に、録った分だけ描く）
    const liveBlock = (): LiveBlock | null => {
      const l = liveRef.current()
      const i = l ? p.project.tracks.findIndex((tr) => tr.id === l.track) : -1
      if (!l || i < 0) return null
      return { ...l, y: trackTop(p.project, i) - vs, h: trackHeight(p.project.tracks[i]), fill: alpha(pal.primary.main, dark ? 0.36 : 0.26), wave: pal.primary.main }
    }
    const draw = () => drawCursors(canvas, view, p.cursor, p.livePos(), colors, liveBlock())
    draw()
    if (!p.playing && !p.recording) return
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
  }, [p.playing, p.recording, p.project, vs, dark, p.cursor, p.livePos, view, width, height, pal, setView])

  // ホイール: Shift で横に動かす。Ctrl で拡大と縮小（マウスの位置を中心に）
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
      // 何も押していなければ縦にスクロール
      if (!e.ctrlKey && !e.shiftKey && !e.deltaX) acc.vy += e.deltaY
      else if (e.ctrlKey) {
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
  const maxRef = useRef(0)
  maxRef.current = maxV
  maxVRef.current = maxV

  const toTime = (x: number) => view.scroll + x / view.pps
  /** 波形ブロックの画面の上の位置（重なって段に分けたときはその段。エンベロープの線を描く所と同じ） */
  const blockGeom = (b: Block) => {
    const row = p.project.tracks.findIndex((t) => t.id === b.track)
    const slot = layoutRows(p.project.blocks.filter((x) => x.track === b.track)).get(b.id) ?? { row: 0, rows: 1 }
    const H = trackHeight(p.project.tracks[row]) / slot.rows
    return { x: (b.start - view.scroll) * view.pps, top: trackTop(p.project, row) + slot.row * H + 2 - vs, h: H - 5 }
  }
  // 目盛りのドラッグで端に来たら表示を流す（WeVocalSynth と同じ wevocal-lib の部品）。流せる先は曲の終わりの少し先まで
  const visible = width / view.pps
  const end = projectEnd(p.project)
  const edge = useEdgeScroll({
    canvasRef,
    view: { start: view.scroll, dur: visible },
    duration: Math.max(end + visible, view.scroll + visible),
    setRange: (start) => setView((v) => ({ ...v, scroll: start })),
    seek: (t) => p.onSeek(Math.max(0, t)),
  })
  // 波形ブロックのドラッグで端に来たときも流す（再生位置は動かさない）
  const blockEdge = useEdgeScroll({
    canvasRef,
    view: { start: view.scroll, dur: visible },
    duration: Math.max(end + visible, view.scroll + visible),
    setRange: (start) => setView((v) => ({ ...v, scroll: start })),
    seek: () => {},
  })
  // ドラッグを始めたときの左端の時刻と、最後に動かした位置（流れている間は指が止まっていても、ブロックが付いてくるように使う）
  const dragScroll0 = useRef(0)
  const lastMove = useRef<{ x: number; y: number; altKey: boolean; shiftKey: boolean } | null>(null)

  const snapping = { mode: p.grid, division: p.division, tempo: p.project.tempo, markers: p.project.markers, pps: view.pps }
  /** 編集カーソルと範囲選択の端は、スナップが入っていればいちばん近いグリッドの線に合わせる（Shift で外す） */
  const gridAt = (x: number, shift: boolean) => {
    const t = Math.max(0, toTime(x))
    if (!p.snap || shift) return t
    const { origin, step } = snapGrid(p.grid, p.project.tempo, view.pps, p.division, p.project.markers, t)
    return Math.max(0, origin + Math.round((t - origin) / step) * step)
  }

  /** 目盛りの上で、x にあるマーカー（旗の幅の中か、線の近く） */
  const markerAtX = (x: number) =>
    p.project.markers.find((m) => {
      const mx = (m.time - view.scroll) * view.pps
      return x >= mx - 4 && x <= mx + 60
    })

  /** ダブルクリック（タッチはダブルタップ）。波形ブロックはプロパティ、エンベロープの点は消す、マーカーは編集 */
  const doubleAt = (x: number, oy: number) => {
    const y = cy(oy)
    // オートメーションの点のダブルクリックは、その点を消す
    if (p.autoEdit && y >= RULER) {
      const lane = laneAt(p.project, y)
      const i = lane ? hitAutoPoint(lane, x, y, view.scroll, view.pps) : -1
      if (lane && i >= 0) return p.onAutoChange(lane.target, lane.lane.slot, lane.lane.param, lane.points.filter((_, k) => k !== i))
    }
    if (y > TOP) {
      const hit = hitBlock(p.project, x, y, toTime, view.pps)
      // MIDI ブロックのダブルクリックは、ピアノロールを開く
      const mh = !hit && hitMidi(p.project, x, y, toTime, view.pps)
      if (mh) return p.onMidiEdit(mh.block.id)
      if (!hit) return
      // エンベロープの点のダブルクリックは、その点を消す
      if (p.envKind) {
        const g = blockGeom(hit.block)
        const spec = ENVELOPES[p.envKind]
        const i = hitEnvPoint(p.envKind, hit.block, x, y, g.x, g.top, g.h, view.pps)
        if (i >= 0) return p.onBlockChange(hit.block.id, spec.patch(hit.block, spec.points(hit.block).filter((_, k) => k !== i)))
      }
      p.onProperties(hit.block.id)
      return
    }
    if (y >= RULER) return
    // 旗の幅の中か、線の近く
    const m = markerAtX(x)
    if (m) p.onMarkerEdit(m.id)
  }

  /** 右クリック（タッチは長押し）のメニュー。押した所が波形ブロックならその操作、空いている所ならその場所の操作 */
  const menuAt = (x: number, oy: number, cx: number, cyClient: number, shift: boolean) => {
    if (marquee.current?.moved) {
      marquee.current = null
      return
    }
    marquee.current = null
    const y = cy(oy)
    const hit = y > TOP ? hitBlock(p.project, x, y, toTime, view.pps) : null
    if (!hit) {
      const track = y > TOP ? (trackAt(y)?.id ?? null) : null
      if (track) p.onSelectTrack(track)
      // 目盛りの上のマーカー（旗の幅の中か、線の近く）を押したら、そのマーカーの操作もメニューに出す
      const mk = y < RULER ? markerAtX(x) : undefined
      return p.onEmptyMenu(y < RULER ? 'ruler' : 'lane', gridAt(x, shift), track, cx, cyClient, mk?.id)
    }
    if (!p.selected.includes(hit.block.id)) p.onSelect([hit.block.id])
    p.onSelectTrack(hit.block.track)
    p.onBlockMenu(hit.block.id, cx, cyClient)
  }

  // タッチの長押しとダブルタップ（iPhone、iPad は contextmenu と dblclick が来ない。PevenMUI。WeVocalSynth と同じ）
  const header = useHeaderWidth()
  const longPress = useLongPress()
  const doubleTap = useDoubleTap()
  // 2 本指のピンチで拡大縮小、目盛りはタップで移動、ドラッグで再生位置、長押しで横移動（wevocal-lib。WeVocalSynth の波形と同じ）
  const touch = useTouchGestures({
    canvasRef,
    view: { start: view.scroll, dur: width / view.pps },
    setRange: (start, dur) => setView(() => ({ scroll: Math.max(0, start), pps: Math.min(2000, Math.max(2, width / dur)) })),
    seekAt: (clientX) => p.onSeek(gridAt(localPos(canvasRef.current!, { clientX, clientY: 0 }).x, false)),
  })
  // 空いている所を 1 本指でなぞったときのスクロール（始めた位置と、そのときの表示）
  // 長押しでメニューを開いたあと（指を離しても、再生位置を移さない）
  const longPressed = useRef(false)
  const pan = useRef<{ x0: number; y0: number; scroll0: number; v0: number } | null>(null)
  // 長押しから始めた範囲選択（動かさずに離したら、メニューを出す）
  const touchRange = useRef<{ x: number; oy: number; cx: number; cy: number; moved: boolean } | null>(null)
  const local = (e: { clientX: number; clientY: number }) => localPos(canvasRef.current!, e)

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // 時間軸を押したら、スライダーなどに残ったフォーカスを外す（キーが時間軸の操作に届くように）
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    const { x, y: ry } = local(e)
    const y = cy(ry)
    // 2 本目の指が触れたらピンチにする（始めたドラッグはやめる）
    if (touch.down(e)) {
      longPress.cancel()
      drag.current = null
      rangeDrag.current = null
      pan.current = null
      return
    }
    if (e.pointerType === 'touch' && y < RULER) {
      e.currentTarget.setPointerCapture(e.pointerId)
      return touch.rulerDown(e)
    }
    if (e.pointerType === 'touch') {
      // 長押しでメニューが開いても、指を離したことがここに届くようにつかんでおく（届かないと、次のタップを 2 本目の指とみなしてしまう）
      e.currentTarget.setPointerCapture(e.pointerId)
      const oy = ry
      const { clientX, clientY } = e
      longPressed.current = false
      touchRange.current = null
      longPress.start(clientX, clientY, () => {
        // 長押しになったら、始めたドラッグはやめる。離したときに再生位置も移さない
        longPressed.current = true
        drag.current = null
        // 空いている所の長押し: そのままなぞると範囲選択、動かさずに離すとメニュー（波形ブロックの上は、すぐメニュー）
        if (y > TOP && !hitBlock(p.project, x, y, toTime, view.pps) && !hitMidi(p.project, x, y, toTime, view.pps)) {
          pan.current = null
          rangeDrag.current = { t: gridAt(x, false), x }
          touchRange.current = { x, oy, cx: clientX, cy: clientY, moved: false }
          navigator.vibrate?.(15)
          return
        }
        menuAt(x, oy, clientX, clientY, false)
      })
    }
    // 右ボタン: ドラッグすれば枠で選ぶ。動かさなければ右クリックのメニュー（onContextMenu）
    if (e.button === 2) {
      if (y > TOP) {
        e.currentTarget.setPointerCapture(e.pointerId)
        marquee.current = { x, y, moved: false }
      }
      return
    }
    // オートメーションの編集: レーンを出しているトラックとマスターでは、点を足す、動かす（波形ブロックの操作はしない）
    if (p.autoEdit && y >= RULER && e.pointerType !== 'touch') {
      const lane = laneAt(p.project, y)
      if (lane) {
        const pts = [...lane.points]
        let index = hitAutoPoint(lane, x, y, view.scroll, view.pps)
        const merge = `auto${dragCount.current++}`
        if (index < 0) {
          const t = Math.max(0, gridAt(x, e.shiftKey))
          index = pts.filter((pt) => pt.t <= t).length
          pts.splice(index, 0, { t, v: fracToParam(lane.def, (y - lane.top) / lane.h) })
          p.onAutoChange(lane.target, lane.lane.slot, lane.lane.param, pts, merge)
        }
        e.currentTarget.setPointerCapture(e.pointerId)
        autoDrag.current = { target: lane.target, index, merge }
        return
      }
    }
    const hit = y > TOP ? hitBlock(p.project, x, y, toTime, view.pps) : null
    if (y < RULER) {
      e.currentTarget.setPointerCapture(e.pointerId)
      scrub.current = true
      p.onSeek(gridAt(x, e.shiftKey))
      return
    }
    // MIDI ブロック（波形ブロックがない所）: 選んで、動かす、端で長さを変える
    if (!hit && y > TOP && !p.envKind && !p.autoEdit && e.pointerType !== 'touch') {
      const mh = hitMidi(p.project, x, y, toTime, view.pps)
      if (mh) {
        p.onSelect([mh.block.id])
        p.onSelectTrack(mh.block.track)
        e.currentTarget.setPointerCapture(e.pointerId)
        midiDrag.current = { id: mh.block.id, kind: mh.kind, grabPx: x - (mh.block.start - view.scroll) * view.pps, merge: `midi${dragCount.current++}` }
        return
      }
    }
    // タッチで空いている所: なぞるとスクロール（長押しはメニュー）
    if (!hit && e.pointerType === 'touch') {
      const track = trackAt(y)
      if (track) p.onSelectTrack(track.id)
      e.currentTarget.setPointerCapture(e.pointerId)
      pan.current = { x0: e.clientX, y0: e.clientY, scroll0: view.scroll, v0: vscroll }
      return
    }
    if (!hit) {
      // 空いている所: 押しただけなら再生位置、ドラッグしたら範囲選択（範囲を選ぶときは再生位置を動かさないよう、再生位置は離したときに移す）
      if (!e.ctrlKey && !e.metaKey) p.onSelect([])
      const track = trackAt(y)
      if (track) p.onSelectTrack(track.id)
      e.currentTarget.setPointerCapture(e.pointerId)
      rangeDrag.current = { t: gridAt(x, e.shiftKey), x }
      return
    }
    const id = hit.block.id
    // エンベロープを出しているときは、点を足すか動かす
    if (p.envKind && !e.altKey) {
      const b = hit.block
      const g = blockGeom(b)
      const spec = ENVELOPES[p.envKind]
      const env = spec.points(b)
      let index = hitEnvPoint(p.envKind, b, x, y, g.x, g.top, g.h, view.pps)
      if (index < 0) {
        const t = Math.max(0, Math.min(b.length, (x - g.x) / view.pps))
        index = env.filter((pt) => pt.t <= t).length
        env.splice(index, 0, { t, v: spec.value((y - g.top) / g.h) })
        p.onBlockChange(b.id, spec.patch(b, env), `env${dragCount.current}`)
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
    dragScroll0.current = view.scroll
    lastMove.current = null
    drag.current = { kind: hit.kind, block: hit.block, others, x, y, trackIndex, merge: `drag${dragCount.current++}`, copy: ctrl && hit.kind === 'move' ? { wasSelected, done: false } : undefined }
  }

  /** ドラッグ中の波形ブロックを、指の位置（と流れた分）に合わせて動かす */
  const moveDrag = (d: NonNullable<typeof drag.current>, x: number, y: number, altKey: boolean, shiftKey: boolean) => {
    // Ctrl で始めたら、動かし始めたときに写しをその場に残す（動かすのは元のもの）
    if (d.copy && !d.copy.done) {
      if (Math.hypot(x - d.x, y - d.y) < 4) return
      d.copy.done = true
      p.onCopyBlocks([d.block, ...d.others])
    }
    // Shift を押している間は吸い付けない
    const raw = (x - d.x) / view.pps + (view.scroll - dragScroll0.current)
    const exclude = [d.block.id, ...d.others.map((b) => b.id)]
    // Alt で本体をつまんだら、中の音だけをずらす（吸い付けない）
    if (altKey && d.kind === 'move') {
      const all = [d.block, ...d.others]
      return p.onBlocksChange(Object.fromEntries(all.map((b) => [b.id, slipPatch(p.project, b, raw)])), d.merge)
    }
    let dt = p.snap && !shiftKey ? snapDelta(d, raw, snapTargets(p.project, p.cursor, exclude), snapping) : raw
    const di = rowDelta(d.y, y)
    // Alt を押しながら端をドラッグすると速度ごと伸び縮みする
    if (!d.others.length) return p.onBlockChange(d.block.id, dragPatch(p.project, d, dt, di, altKey), d.merge)
    // まとめて動かす。一番前のものが 0 より前に出ない所、トラックの外に出ない所で止める
    const all = [d.block, ...d.others]
    dt = Math.max(dt, -Math.min(...all.map((b) => b.start)))
    const rows = all.map((b) => p.project.tracks.findIndex((t) => t.id === b.track))
    const shift = Math.max(-Math.min(...rows), Math.min(p.project.tracks.length - 1 - Math.max(...rows), di))
    p.onBlocksChange(Object.fromEntries(all.map((b, i) => [b.id, { start: b.start + dt, track: p.project.tracks[rows[i] + shift].id }])), d.merge)
  }

  /** ドラッグしている MIDI ブロックを、指の位置に合わせて動かす（波形ブロックと同じく、縦に動かすとほかのトラックへ移り、端で表示が流れる） */
  const moveMidi = (md: NonNullable<typeof midiDrag.current>, x: number, y: number, shiftKey: boolean) => {
    const b = (p.project.midi ?? []).find((q) => q.id === md.id)
    if (!b) return
    if (md.kind === 'move') {
      const tr = trackAt(y)
      return p.onMidiChange(b.id, { start: Math.max(0, gridAt(x - md.grabPx, shiftKey)), ...(tr ? { track: tr.id } : {}) }, md.merge)
    }
    p.onMidiChange(b.id, { length: Math.max(0.05, gridAt(x, shiftKey) - b.start) }, md.merge)
  }

  // 端で表示が流れている間は、指が動かなくても波形ブロックと MIDI ブロックを付いてこさせる
  useEffect(() => {
    const d = drag.current
    const m = lastMove.current
    if (d && m) moveDrag(d, m.x, m.y, m.altKey, m.shiftKey)
    else if (midiDrag.current && m) moveMidi(midiDrag.current, m.x, m.y, m.shiftKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.scroll])

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    longPress.move(e.clientX, e.clientY)
    if (touch.move(e)) return
    const pn = pan.current
    if (pn) {
      setView((v) => ({ ...v, scroll: Math.max(0, pn.scroll0 - (e.clientX - pn.x0) / v.pps) }))
      setVscroll(Math.max(0, Math.min(maxRef.current, pn.v0 - (e.clientY - pn.y0))))
      return
    }
    const { x, y: ry } = local(e)
    const y = cy(ry)
    const md = midiDrag.current
    if (md) {
      // 端に来たら表示を流し、上下の端では縦にスクロールする（波形ブロックと同じ）
      blockEdge.update(e.clientX)
      const oy = ry
      if (oy > height - 24) setVscroll((v) => Math.min(maxRef.current, v + 8))
      else if (oy > TOP && oy < TOP + 24) setVscroll((v) => Math.max(0, v - 8))
      lastMove.current = { x, y, altKey: e.altKey, shiftKey: e.shiftKey }
      return moveMidi(md, x, y, e.shiftKey)
    }
    const ad = autoDrag.current
    if (ad) {
      const lane = allLanes(p.project).find((l) => l.target === ad.target)
      if (!lane || !lane.points[ad.index]) return
      const pts = [...lane.points]
      // 前後の点は越えない
      const lo = pts[ad.index - 1]?.t ?? 0
      const hi = pts[ad.index + 1]?.t ?? Infinity
      pts[ad.index] = { t: Math.max(lo, Math.min(hi, gridAt(x, e.shiftKey))), v: fracToParam(lane.def, (y - lane.top) / lane.h) }
      return p.onAutoChange(lane.target, lane.lane.slot, lane.lane.param, pts, ad.merge)
    }
    const ed = envDrag.current
    if (ed) {
      const b = p.project.blocks.find((x) => x.id === ed.block)
      if (!b || !p.envKind) return
      const g = blockGeom(b)
      const spec = ENVELOPES[p.envKind]
      const env = spec.points(b)
      if (!env[ed.index]) return
      // 前後の点は越えない
      const lo = env[ed.index - 1]?.t ?? 0
      const hi = env[ed.index + 1]?.t ?? b.length
      env[ed.index] = { t: Math.max(lo, Math.min(hi, (x - g.x) / view.pps)), v: spec.value((y - g.top) / g.h) }
      return p.onBlockChange(b.id, spec.patch(b, env), ed.merge)
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
      const ra = slotAt(Math.min(mq.y, y))
      const rb = slotAt(Math.max(mq.y, y))
      p.onSelect(
        p.project.blocks
          .filter((b) => {
            const r = p.project.tracks.findIndex((t) => t.id === b.track)
            return r >= ra && r <= rb && b.start < tb && b.start + b.length > ta
          })
          .map((b) => b.id),
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
      if (touchRange.current) touchRange.current.moved = true
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
    blockEdge.update(e.clientX)
    const oy = ry
    if (oy > height - 24) setVscroll((v) => Math.min(maxRef.current, v + 8))
    else if (oy > TOP && oy < TOP + 24) setVscroll((v) => Math.max(0, v - 8))
    lastMove.current = { x, y, altKey: e.altKey, shiftKey: e.shiftKey }
    moveDrag(d, x, y, e.altKey, e.shiftKey)
  }

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    longPress.cancel()
    if (touch.up(e)) return
    // なぞらずに離したら、押した所へ再生位置を移す
    const pn = pan.current
    pan.current = null
    if (pn && !longPressed.current && Math.hypot(e.clientX - pn.x0, e.clientY - pn.y0) < 8) {
      p.onSelect([])
      p.onSeek(gridAt(local(e).x, false))
    }
    if (e.pointerType === 'touch' && doubleTap.tap(e.clientX, e.clientY)) doubleAt(local(e).x, local(e).y)
    envDrag.current = null
    autoDrag.current = null
    midiDrag.current = null
    // 長押しから始めた範囲選択を、動かさずに離したら、そこにメニューを出す
    const tr = touchRange.current
    touchRange.current = null
    if (tr && !tr.moved) {
      rangeDrag.current = null
      menuAt(tr.x, tr.oy, tr.cx, tr.cy, false)
    }
    if (marquee.current) {
      // 動かしたら、このあとの右クリックのメニューは出さない
      if (!marquee.current.moved) marquee.current = null
      setBox(null)
    }
    // 範囲を作らずに離したら、範囲を消す
    if (rangeDrag.current && Math.abs(local(e).x - rangeDrag.current.x) < 3) {
      p.onRange(null)
      p.onSeek(gridAt(rangeDrag.current.x, e.shiftKey))
    }
    // Ctrl で押して動かさずに離したら、選択の足し引き（選んでいたものは外す）
    const d = drag.current
    if (d?.copy && !d.copy.done && d.copy.wasSelected) p.onSelect(p.selected.filter((s) => s !== d.block.id))
    rangeDrag.current = null
    scrub.current = false
    edge.stop()
    blockEdge.stop()
    lastMove.current = null
    drag.current = null
    p.onEndMerge()
  }

  // ファイルを落としたトラックと時刻に置く（トラックの外なら空いているトラックか新しいトラック）
  const onDrop = (e: React.DragEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    e.stopPropagation()
    const at = local(e)
    const track = trackAt(cy(at.y))
    p.onDropFiles(Array.from(e.dataTransfer.files), track && { track: track.id, start: Math.max(0, toTime(at.x)) })
  }

  return (
    <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex' }}>
        <Box sx={{ width: header, flexShrink: 0, borderRight: 1, borderColor: 'divider', display: 'flex', flexDirection: 'column' }}>
          <Box sx={{ height: RULER, borderBottom: 1, borderColor: 'divider', boxSizing: 'border-box', flexShrink: 0 }} />
          <MasterHeader master={p.project.master} height={MASTER} onFx={() => p.onFx('master')} onChange={p.onMasterChange} onEndMerge={p.onEndMerge} meter={p.masterMeter} />
          {/* トラックの欄は、時間軸と同じだけ縦にずらす（ホイールでもスクロール） */}
          <Box
            ref={headerContainerRef as React.RefObject<HTMLDivElement>}
            sx={{ flex: 1, minHeight: 0, overflow: 'hidden', position: 'relative' }}
            onWheel={(e) => setVscroll((v) => Math.max(0, Math.min(maxV, v + e.deltaY)))}
            onPointerMove={(e) => {
              const resizing = trackResizeRef.current
              if (resizing) {
                p.onTrackChange(resizing.id, { height: Math.max(TRACK_HEIGHT_MIN, Math.min(TRACK_HEIGHT_MAX, resizing.height + e.clientY - resizing.y)) }, resizing.merge)
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
              if (trackResizeRef.current) p.onEndMerge()
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
                  selected={p.selectedTracks.includes(track.id)}
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
                  onFx={() => p.onFx(track.id)}
                  meter={p.meter && (() => p.meter!(track.id))}
                  depth={depthOf(p.tree, track)}
                  hasChildren={p.tree.tracks.some((t) => t.parent === track.id)}
                  onAddSubtrack={() => p.onTrackOp('addSubtrack', track.id)}
                  onIndent={() => p.onTrackOp('indent', track.id)}
                  onOutdent={() => p.onTrackOp('outdent', track.id)}
                  onMoveUp={() => i > 0 && p.onMoveTrack(track.id, i - 1)}
                  onMoveDown={() => i < p.project.tracks.length - 1 && p.onMoveTrack(track.id, i + 2)}
                  onDuplicate={() => p.onDuplicateTrack(track.id)}
                  onFreeze={() => p.onFreezeTrack(track.id)}
                  onSends={() => p.onSends(track.id)}
                  onRemove={() => p.onRemoveTrack(track.id)}
                />
              )})}
            </Box>
          </Box>
        </Box>
        <Box ref={boxRef} sx={{ flex: 1, minWidth: 0, position: 'relative' }}>
          {box && (
            <Box
              sx={{
                position: 'absolute',
                left: box.x0,
                top: box.y0,
                width: box.x1 - box.x0,
                height: box.y1 - box.y0,
                border: 1,
                borderColor: 'primary.main',
                bgcolor: alpha(pal.primary.main, 0.12),
                pointerEvents: 'none',
              }}
            />
          )}
          {/* カーソルの線だけを描く canvas（押す操作は下の canvas が受ける） */}
          <canvas ref={overlayRef} style={{ position: 'absolute', left: 0, top: 0, width, height, pointerEvents: 'none' }} />
          <canvas
            ref={canvasRef}
            style={{ display: 'block', width, height, touchAction: 'none', cursor }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onDoubleClick={(e) => doubleAt(local(e).x, local(e).y)}
            onContextMenu={(e) => {
              e.preventDefault()
              menuAt(local(e).x, local(e).y, e.clientX, e.clientY, e.shiftKey)
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
          />
        </Box>
        {/* 縦のスクロールバー（トラックの行。目盛りとマスターは固定なので、見えている高さと全体の高さで示す） */}
        <ScrollBar orientation="vertical" total={content} start={vs} size={vh} onChange={(v) => setVscroll(Math.max(0, Math.min(maxV, v)))} />
      </Box>
      {/* 横のスクロールバー（時間。曲の終わりの少し先まで動かせる） */}
      <Box sx={{ display: 'flex', flexShrink: 0, borderTop: 1, borderColor: 'divider' }}>
        <Box sx={{ width: header, flexShrink: 0, borderRight: 1, borderColor: 'divider' }} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <ScrollBar orientation="horizontal" total={Math.max(songEnd(p.project) + visibleSec * 0.25, view.scroll + visibleSec)} start={view.scroll} size={visibleSec} onChange={(t) => setView((v) => ({ ...v, scroll: Math.max(0, t) }))} />
        </Box>
        <Box sx={{ width: 10, flexShrink: 0 }} />
      </Box>
    </Box>
  )
}
