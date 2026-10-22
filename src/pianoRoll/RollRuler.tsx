// ピアノロールの目盛り（小節と拍の数字）と、ブロックの終わりの旗。旗をドラッグすると、ブロックの範囲を広げたり狭めたりできる。再生位置と編集位置の線、範囲選択も出す。
// 押すと編集位置、なぞると範囲選択（スナップが入っていれば線に合わせ、Shift で外す。メインの時間軸と同じ）
import { useLayoutEffect, useRef } from 'react'
import { Box } from '@mui/material'
import { localPoint, useBoxSize, usePalette } from 'pevenmui'
import { SELECTION_DARK, SELECTION_LIGHT, alpha } from 'wevocal-lib'
import { snapToStep } from '../grid'
import { KEYS, beatX, xBeat, type View } from './view'

/** 目盛りの高さ（px） */
export const RULER = 24
/** 旗をつかめる幅（px） */
const FLAG = 10

export default function RollRuler(p: {
  /** 表示の位置（左端の拍と、1 拍の幅。幅は、この部品の幅から決める） */
  view: View
  /** ブロックの長さ（拍） */
  len: number
  /** 1 小節の拍数と、ブロックの頭が曲の何拍目か（小節の番号を、曲全体で数えるため） */
  beatsPerBar: number
  origin: number
  /** グリッドの間隔（拍） */
  step: number
  /** グリッドに合わせるか（Shift で外す） */
  snapOn: boolean
  /** 再生位置（拍。なければ null） */
  play: number | null
  /** 編集位置と範囲選択（拍。なければ null）。押すと編集位置、なぞると範囲を変える */
  cursor: number | null
  range: { a: number; b: number } | null
  onCursor: (beat: number) => void
  onRange: (range: { a: number; b: number } | null) => void
  /** 旗をドラッグして、ブロックの長さ（拍）を変える。merge は 1 回のドラッグで同じ値 */
  onLength: (beats: number, merge: string) => void
}) {
  const { pal, dark } = usePalette()
  const box = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const { width } = useBoxSize(box)
  const drag = useRef<string | null>(null)
  /** 旗以外を押したとき: 押した所（拍）と、なぞったか */
  const press = useRef<{ x: number; beat: number; moved: boolean } | null>(null)
  const v = { ...p.view, w: width }

  useLayoutEffect(() => {
    const c = canvas.current
    if (!c || width < 1) return
    const g = c.getContext('2d')!
    c.width = width * devicePixelRatio
    c.height = RULER * devicePixelRatio
    g.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)
    g.fillStyle = pal.background.paper
    g.fillRect(0, 0, width, RULER)
    g.font = '11px Roboto, sans-serif'
    g.textBaseline = 'middle'
    // 拍の線と、小節の数字（拍の間が広ければ「小節.拍」も）
    const bpb = Math.max(1, p.beatsPerBar)
    for (let b = Math.ceil(v.left); b <= v.left + (width - KEYS) / v.ppb && b <= p.len + 1e-6; b++) {
      const abs = Math.round(p.origin + b)
      const inBar = ((abs % bpb) + bpb) % bpb
      const x = Math.round(beatX(v, b)) + 0.5
      if (x < KEYS) continue
      g.fillStyle = pal.divider
      g.fillRect(x, inBar === 0 ? RULER - 9 : RULER - 5, 1, inBar === 0 ? 9 : 5)
      const bar = Math.floor(abs / bpb) + 1
      const label = inBar === 0 ? String(bar) : v.ppb >= 48 ? `${bar}.${inBar + 1}` : ''
      if (label) {
        g.fillStyle = inBar === 0 ? pal.text.primary : pal.text.secondary
        g.fillText(label, x + 3, RULER / 2 - 2)
      }
    }
    // ブロックの外（終わりより先）を暗くして、終わりに旗を立てる
    const end = beatX(v, p.len)
    if (end < width) {
      g.fillStyle = pal.action.hover
      g.fillRect(end, 0, width - end, RULER)
    }
    g.fillStyle = pal.primary.main
    g.fillRect(end - 1, 0, 2, RULER)
    g.beginPath()
    g.moveTo(end, 0)
    g.lineTo(end - 9, 0)
    g.lineTo(end, 9)
    g.fill()
    if (p.range) {
      const x0 = Math.max(KEYS, beatX(v, p.range.a))
      const x1 = Math.min(width, beatX(v, p.range.b))
      if (x1 > x0) {
        g.fillStyle = alpha(dark ? SELECTION_DARK : SELECTION_LIGHT, 0.35)
        g.fillRect(x0, 0, x1 - x0, RULER)
      }
    }
    if (p.cursor !== null) {
      g.fillStyle = '#e53935'
      g.fillRect(beatX(v, p.cursor) - 0.5, 0, 1.5, RULER)
    }
    if (p.play !== null) {
      g.fillStyle = pal.error.main
      g.fillRect(beatX(v, p.play), 0, 1, RULER)
    }
    g.fillStyle = pal.divider
    g.fillRect(0, RULER - 1, width, 1)
  })

  const pos = (e: React.PointerEvent) => localPoint(canvas.current!, e.clientX, e.clientY).x
  const snapped = (x: number) => Math.max(p.step, Math.round(xBeat(v, x) / p.step) * p.step)
  /** 編集位置と範囲の端（ブロックの中に収める。スナップが入っていれば線に合わせ、Shift で外す） */
  const beatAt = (x: number, shift: boolean) => {
    const b = Math.max(0, Math.min(p.len, xBeat(v, x)))
    return p.snapOn && !shift ? Math.max(0, Math.min(p.len, snapToStep(b, 0, p.step))) : b
  }
  return (
    <Box ref={box} sx={{ height: RULER, flexShrink: 0 }}>
      <canvas
        ref={canvas}
        style={{ display: 'block', width: '100%', height: RULER, touchAction: 'none', cursor: 'pointer' }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          // 旗の近くを押したときは、つかむ。ほかは、編集位置（なぞれば範囲選択）
          if (Math.abs(pos(e) - beatX(v, p.len)) <= FLAG) {
            drag.current = `len${Date.now()}`
            return
          }
          press.current = { x: pos(e), beat: beatAt(pos(e), e.shiftKey), moved: false }
        }}
        onPointerMove={(e) => {
          if (drag.current) return p.onLength(snapped(pos(e)), drag.current)
          const s = press.current
          if (!s || (!s.moved && Math.abs(pos(e) - s.x) < 3)) return
          s.moved = true
          const b = beatAt(pos(e), e.shiftKey)
          p.onRange({ a: Math.min(s.beat, b), b: Math.max(s.beat, b) })
        }}
        onPointerUp={() => {
          // なぞらずに離したら、範囲を消して、押した所を編集位置にする（メインの時間軸と同じ）
          const s = press.current
          if (s && !s.moved) {
            p.onRange(null)
            p.onCursor(s.beat)
          }
          drag.current = null
          press.current = null
        }}
        onPointerCancel={() => {
          drag.current = null
          press.current = null
        }}
      />
    </Box>
  )
}
