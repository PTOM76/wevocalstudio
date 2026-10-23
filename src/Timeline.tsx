// 時間軸。左にトラックの欄、右に波形ブロックを並べた canvas。波形ブロックはドラッグで動かし（ほかのトラックへも移せる）、端で長さ、上の角でフェードを変える
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Box } from '@mui/material'
import { alpha } from 'wevocal-lib'
import { ScrollBar, useBoxSize, usePalette } from 'pevenmui'
import { countRender } from 'pevenmui/debug'
import { layoutRows } from './overlap'
import { songEnd, trackHeight, TRACK_HEIGHT_DEFAULT, type PitchEnvelopeRange, type VolumeEnvelopeRange } from './project'
import { type EnvKind } from './envelopes'
import { type GridDivision, type GridMode } from './grid'
import { topOf, totalTrackHeight, trackTop, type TimelineView } from './drawTimeline'
import type { Block, Project } from './project'
import type { DropAt } from './useProject'
import TrackColumn from './timeline/TrackColumn'
import { useTimelinePointer } from './timeline/useTimelinePointer'
import { localPos } from './timeline/geometry'
import { useTimelineDraw } from './timeline/useTimelineDraw'
import { useTimelineWheel } from './timeline/useTimelineWheel'
export { useHeaderWidth } from './timeline/useHeaderWidth'

export interface TimelineProps {
  project: Project
  /** 編集カーソル */
  cursor: number
  /** 再生カーソルの今の位置（再生中と一時停止中だけ。再生中は毎フレーム読む） */
  livePos: () => number | null
  /** 再生位置に表示を追従させる */
  follow: boolean
  /** ホイールで拡大縮小する操作（ctrl は Ctrl 併用、wheel はホイールだけ。もう一方は縦のスクロール） */
  wheelZoom: 'ctrl' | 'wheel'
  /** 編集カーソルだけを動かす（波形ブロックを押したとき） */
  onCursor: (t: number) => void
  selectedTrack: string | null
  onSelectTrack: (id: string) => void
  /** タッチ端末でタップによる追加選択をする */
  selectMode: boolean
  onSeek: (t: number) => void
  /** トラック一覧の幅と、その境目の分割バー（App で持つ。解析の欄の左の幅にもそろえる） */
  headerWidth: number
  headerBar: ReactNode
  /** トラックの欄を閉じているか、開閉する */
  headerCollapsed: boolean
  onToggleHeader: () => void
  onDropFiles: (files: File[], at?: DropAt) => void
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
  onFreezeTrack: (id: string, withFx?: boolean) => void
  /** 選択中のトラックのプロパティを開く */
  onTrackProperties: (ids: string[]) => void
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
  /** エンベロープの道具がペンか（false は選択。選択のときは、線と点だけを触る） */
  envPen: boolean
  /** エンベロープの線か点の右クリックのメニューを開く（波形ブロックの id、押した点の番号。点でなければ -1） */
  onEnvMenu: (block: string, index: number, x: number, y: number) => void
  envelopeRange: VolumeEnvelopeRange
  pitchEnvelopeRange: PitchEnvelopeRange
  /** オートメーションを編集する（FX のダイアログで選んだつまみのレーンの点を、足す、動かす、消す） */
  autoEdit: boolean
  /** MIDI ブロックのダブルクリック（ピアノロールを開く） */
  onMidiEdit: (id: string) => void
  onView: (fn: (v: TimelineView) => TimelineView) => void
  /** 波形を描く所の幅（px。ミニマップの枠に使う） */
  onWidth: (w: number) => void
  /** かたまりができるたびに増える（「処理中」を描き直す） */
  madeVersion: number
  /** 作り直している波形ブロックに出す文字（「処理中」） */
  pendingLabel: string
}

export default function Timeline(p: TimelineProps) {
  countRender('Timeline')
  // theme.palette は常にライトの値なので、今の配色は usePalette で取る（Synth の docs/CODING.md）
  const { pal } = usePalette()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { view } = p
  const setView = p.onView
  // 描く場所の大きさ（変わった同じフレームで更新する。PevenMUI の useBoxSize）
  const boxRef = useRef<HTMLDivElement>(null)
  const { width, height: vh } = useBoxSize(boxRef)
  // 縦のスクロール。canvas は見える高さに固定し、トラックの行だけをずらす（目盛りとマスターは上に固定）
  const [vscroll, setVscroll] = useState(0)
  const TOP = topOf(p.project)
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

  // トラックの高さのドラッグ（欄の側が使う。Esc の取り消しはここから merge を読む）
  const trackResizeRef = useRef<{ id: string; y: number; height: number; merge: string } | null>(null)
  const wheelZoomRef = useRef(p.wheelZoom)
  wheelZoomRef.current = p.wheelZoom

  // 幅を App に知らせる
  const { onWidth } = p
  useEffect(() => onWidth(width), [width, onWidth])

  const overlayRef = useRef<HTMLCanvasElement>(null)
  useTimelineDraw({ p, canvasRef, overlayRef, view, width, height, vs, top: TOP, setView })

  const maxRef = useRef(0)
  maxRef.current = maxV
  useTimelineWheel({ canvasRef, wheelZoomRef, maxRef, setVscroll, setView })

  const toTime = (x: number) => view.scroll + x / view.pps
  /** 波形ブロックの画面の上の位置（重なって段に分けたときはその段。エンベロープの線を描く所と同じ） */
  const blockGeom = (b: Block) => {
    const row = p.project.tracks.findIndex((t) => t.id === b.track)
    const slot = layoutRows(p.project.blocks).get(b.id) ?? { row: 0, rows: 1 }
    const H = trackHeight(p.project.tracks[row]) / slot.rows
    return { x: (b.start - view.scroll) * view.pps, top: trackTop(p.project, row) + slot.row * H + 2, h: H - 5 }
  }
  const { box, cursor, onPointerDown, onPointerMove, onPointerUp, doubleAt, menuAt } = useTimelinePointer({ p, canvasRef, view, setView, vs, vscroll, setVscroll, maxRef, top: TOP, width, height, trackResizeRef, geo: { cy, trackAt, rowDelta, slotAt, toTime, blockGeom } })
  const header = p.headerWidth
  const local = (e: { clientX: number; clientY: number }) => localPos(canvasRef.current!, e)
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
        <TrackColumn p={p} vs={vs} maxV={maxV} top={TOP} setVscroll={setVscroll} slotAt={slotAt} resizeRef={trackResizeRef} />
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
