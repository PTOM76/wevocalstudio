// 時間軸を描く。全体（トラック、波形ブロック、目盛り、範囲）は変わったときだけ描き直し、カーソルの線は上に重ねた canvas に描く（再生中は毎フレーム、再生位置を自分で読んでこれだけを描き直す。画面全体を描き直さない）
import { useLayoutEffect, useRef } from 'react'
import { SELECTION_DARK, SELECTION_LIGHT, alpha } from 'wevocal-lib'
import { usePalette } from 'pevenmui'
import { markActivity } from 'pevenmui/debug'
import { useDoc } from '../DocContext'
import { drawCursors, drawTimeline, trackTop, type LiveBlock, type TimelineView } from '../drawTimeline'
import { trackHeight } from '../project'
import type { TimelineProps } from '../Timeline'
import { fitCanvas } from './geometry'

export function useTimelineDraw(o: {
  p: TimelineProps
  canvasRef: { current: HTMLCanvasElement | null }
  overlayRef: { current: HTMLCanvasElement | null }
  view: TimelineView
  width: number
  height: number
  /** 縦のスクロール、目盛りとマスターの高さ */
  vs: number
  top: number
  setView: (fn: (v: TimelineView) => TimelineView) => void
}) {
  const { p, canvasRef, overlayRef, view, width, height, vs, top: TOP, setView } = o
  const doc = useDoc()
  // theme.palette は常にライトの値なので、今の配色は usePalette で取る（Synth の docs/CODING.md）
  const { dark, pal } = usePalette()
  useLayoutEffect(() => {
    const canvas = canvasRef.current!
    // 大きさが変わったときだけ設定する（代入すると、同じ値でも描画のバッファを作り直すため、スクロールのたびに重くなる。描くときに全体を塗り直す）
    fitCanvas(canvas, width, height)
    markActivity('draw timeline')
    // 色は WeVocalSynth の波形と同じ（波形は主の色、再生位置は文字の色、範囲選択はシアン）
    drawTimeline(
      canvas,
      p.project,
      view,
      doc.selected,
      doc.range,
      { grid: p.grid, division: p.division, pendingLabel: p.pendingLabel, envKind: p.envKind, envelopeRange: p.envelopeRange, pitchEnvelopeRange: p.pitchEnvelopeRange, autoEdit: p.autoEdit, vscroll: vs, trackNames: p.headerCollapsed },
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
  }, [p.project, view, doc.selected, doc.range, width, height, dark, pal, p.grid, p.division, p.madeVersion, p.pendingLabel, p.envKind, p.envelopeRange, p.pitchEnvelopeRange, p.autoEdit, vs, p.headerCollapsed])

  // カーソルの線は上に重ねた canvas に描く。再生中は毎フレーム、再生位置を自分で読んでこれだけを描き直す（画面全体を描き直さない）
  const liveRef = useRef(p.live)
  liveRef.current = p.live
  const followRef = useRef({ follow: p.follow, visible: 0, scroll: 0 })
  followRef.current = { follow: p.follow, visible: width / view.pps, scroll: view.scroll }
  useLayoutEffect(() => {
    const canvas = overlayRef.current!
    // 大きさが変わったときだけ設定する（代入すると、同じ値でも描画のバッファを作り直すため、スクロールのたびに重くなる。描くときに全体を塗り直す）
    fitCanvas(canvas, width, height)
    const colors = { editCursor: '#e53935', playhead: pal.text.primary }
    // 録音中の波形ブロック（録っているトラックの行に、録った分だけ描く）
    const liveBlock = (): LiveBlock | null => {
      const l = liveRef.current()
      const i = l ? p.project.tracks.findIndex((tr) => tr.id === l.track) : -1
      if (!l || i < 0) return null
      return { ...l, y: trackTop(p.project, i) - vs, h: trackHeight(p.project.tracks[i]), fill: alpha(pal.primary.main, dark ? 0.36 : 0.26), wave: pal.primary.main }
    }
    const draw = () => drawCursors(canvas, TOP, view, p.cursor, p.livePos(), colors, liveBlock())
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
}
