// ピアノロールの本体（MIDI ブロックの音符を編集する）。ダイアログの枠は PianoRollDialog.tsx。
// 空いている所を押すと音符を足し（そのままドラッグで長さ）、音符を押してドラッグで動かし、右端で長さを変え、ダブルクリックか Delete で消す。
// Shift を押しながらクリックで選択の足し引き、Shift を押しながら空いている所をドラッグで枠で選ぶ、Ctrl+A で全部。選んだものは一緒に動く。
// 左の鍵盤を押すと、その高さの音が鳴る。道具（選択、ペン、消しゴム）、ズーム、再生はこの中のツールバーにある（別のウィンドウに出しても使えるよう）。操作の説明は右上の ? のツールチップ（roll.help）。下の帯は音の強さ（ベロシティ）。Ctrl+ホイールで横の拡大、Shift+ホイールで横のスクロール、Alt+ホイールで行の高さ、ホイールで音の高さをずらす。Alt を押している間はグリッドに合わせない
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Box } from '@mui/material'
import { ScrollBar, localPoint, useBoxSize, usePalette } from 'pevenmui'
import { blockBeats, projectBeatMap } from '../beats'
import { useT } from '../i18n'
import { newId, type MidiBlock, type MidiCurve, type Note, type Project } from '../project'
import { drawRoll } from './draw'
import NoteMenu from './NoteMenu'
import InfoLine, { laneLabelOf } from './InfoLine'
import RollRuler from './RollRuler'
import ScreenKeyboard from './ScreenKeyboard'
import { useStepInput } from './useStepInput'
import RollToolbar, { type Tool } from './Toolbar'
import { selectionEnd, setMute, slice } from './edit'
import { hasClipboard, useRollEdit } from './useRollEdit'
import { usePinch } from './usePinch'
import { useRollWheel } from './useRollWheel'
import { hitNote, hitVel } from './hit'
import { curveOf, hitPoint, lanePoints, valueAt, withPoints, type Lane } from './laneEdit'
import { curveRange } from '../midiCurves'
import { EDGE, GAP, KEYS, ROW_MIN, SCALES, type ScaleKind, VEL, clampView, rollHeight, rowPitch, rowsOf, pitchY, stepOf, visibleBeats, xBeat } from './view'

type Drag =
  | { kind: 'move'; start: Note[]; beat0: number; pitch0: number; merge: string }
  | { kind: 'size'; start: Note[]; beat0: number; merge: string }
  | { kind: 'vel'; id: string; merge: string }
  | { kind: 'point'; index: number; merge: string }
  | { kind: 'box'; x0: number; y0: number }
  | { kind: 'key' }
  /** 指 1 本で空いている所をなぞる: スクロール（動かさずに離すと音符を足し、長押しすると枠で選ぶ） */
  | { kind: 'pan'; x: number; y: number; cx: number; cy: number; left0: number; low0: number; t0: number; moved: boolean; timer: number }
  | { kind: 'erase'; merge: string }
  | { kind: 'mute'; value: boolean; merge: string }


/** キーでの道具の切り替え（FL Studio にならう） */
export interface PianoRollProps {
  project: Project
  block: MidiBlock
  /** グリッドの細かさ（時間軸と同じ設定） */
  division: number
  onDivision: (division: number) => void
  onChange: (notes: Note[], merge?: string) => void
  /** コントロールの曲線（CC、ピッチベンド）を入れ替える */
  onCurves: (curves: MidiCurve[] | undefined, merge?: string) => void
  /** 音源で音を鳴らす、離す（音符を押したとき、動かして高さが変わったとき） */
  onPreview?: (pitch: number, vel: number, on: boolean) => void
  /** 再生中か、再生位置（秒）。再生位置の線を描く */
  playing: boolean
  position: () => number
  /** 再生と一時停止の切り替え（別のウィンドウでも、ピアノロールの中で操作できるように） */
  onTogglePlay: () => void
  /** ピアノロールのブロックの範囲だけを再生する（loop ならその範囲を繰り返す） */
  onPlayBlock: (loop: boolean) => void
  /** ブロックの長さ（拍）を変える（目盛りの旗のドラッグ）。merge は 1 回のドラッグで同じ値 */
  onLength: (beats: number, merge: string) => void
  /** メニューバーとツールバーを出すか（既定は出す） */
  toolbar?: boolean
  /** 画面の下の欄（ドック）に置いているとき、メインのツールバーの中の場所。あれば、そこにメニューバーとボタンを出す */
  chromeHost?: HTMLElement | null
}

export default function PianoRoll(p: PianoRollProps) {
  const t = useT()
  const { pal } = usePalette()
  const laneLabel = (l: Lane) => laneLabelOf(t, l)
  const canvas = useRef<HTMLCanvasElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const { width, height } = useBoxSize(box)
  const { block } = p
  // 表示の位置: 左端の拍、1 拍の幅（null はブロック全体が収まる幅）、一番下の音、1 行の高さ
  const [left, setLeft] = useState(0)
  const [zoom, setZoom] = useState<number | null>(null)
  const [low, setLow] = useState(48)
  // 指で操作する端末では、行を高くする
  const [row, setRow] = useState(() => (window.matchMedia?.('(pointer: coarse)').matches ? 24 : 14))
  const [sel, setSel] = useState<string[]>([])
  // グリッドに合わせる（Alt を押している間は逆）
  const [snapOn, setSnapOn] = useState(true)
  const [tool, setTool] = useState<Tool>('select')
  // 下のレーン（強さ、ピッチベンド、CC）
  const [lane, setLane] = useState<Lane>('vel')
  const points = lanePoints(block.curves, lane)
  const laneInfo = curveOf(lane)
  // 音の確認（鳴らすか）と、スケールの強調
  const [preview, setPreview] = useState(true)
  // 画面の鍵盤（指で操作する端末では最初から出す）と、その一番左の C
  const [kb, setKb] = useState(() => !!window.matchMedia?.('(pointer: coarse)').matches)
  const [kbBase, setKbBase] = useState(48)
  const [fold, setFold] = useState(false)
  const [loopPlay, setLoopPlay] = useState(false)
  const foldRef = useRef<number[]>([])
  const [scale, setScale] = useState<{ root: number; kind: ScaleKind }>({ root: 0, kind: 'none' })
  const [frame, setFrame] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const [play, setPlay] = useState<number | null>(null)
  // 鳴らしている音（鍵盤の色付け）
  const [held, setHeld] = useState<number | null>(null)
  const drag = useRef<Drag | null>(null)
  // 指の操作: 今の指か（右端をつかめる幅を広げる）、触れている指の位置、2 本指のつまみ
  const touch = useRef(false)
  const pinch = usePinch(canvas, { zoom: setZoom, left: setLeft, low: setLow })
  const [noteMenu, setNoteMenu] = useState<{ x: number; y: number } | null>(null)
  const edgePx = () => (touch.current ? 18 : EDGE)
  const count = useRef(0)
  const lastDur = useRef(0)
  // 今鳴らしている音（動かして高さが変わったら、離して鳴らし直す）
  const sounding = useRef<number | null>(null)
  const step = stepOf(p.division)
  const map = projectBeatMap(p.project)
  const len = blockBeats(map, block)
  const fit = Math.max(1, (width - KEYS) / Math.max(len, step * 4))
  // 折りたたみ: 音符のある高さの行だけを見せる（ドラッグの間は、行がずれないよう、始めたときの並びのまま）
  if (!drag.current || !foldRef.current.length) foldRef.current = [...new Set(block.notes.map((n) => n.pitch))].sort((a, b) => b - a)
  const folded = fold && foldRef.current.length ? foldRef.current : null
  // 行を高くして、画面を使う（高くしすぎない）
  const rowPx = folded ? Math.max(ROW_MIN, Math.min(Math.max(row, 36), Math.floor((height - GAP - VEL) / folded.length))) : row
  const view = clampView({ left, ppb: zoom ?? fit, low, row: rowPx, fold: folded, w: width, h: height }, len)
  const viewRef = useRef(view)
  viewRef.current = view
  const snap = (beat: number, free: boolean) => (free || !snapOn ? beat : Math.round(beat / step) * step)

  const sound = (pitch: number | null, vel = 0.8) => {
    if (!preview && pitch !== null) return
    if (sounding.current !== null && sounding.current !== pitch) p.onPreview?.(sounding.current, 0, false)
    if (pitch !== null && sounding.current !== pitch) p.onPreview?.(pitch, vel, true)
    sounding.current = pitch
    setHeld(pitch)
  }

  useLayoutEffect(() => {
    const c = canvas.current
    if (!c || width < 1 || height < 1) return
    const g = c.getContext('2d')!
    c.width = width * devicePixelRatio
    c.height = height * devicePixelRatio
    g.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)
    drawRoll(g, {
      view,
      notes: block.notes,
      selected: sel,
      len,
      step,
      beatsPerBar: p.project.tempo.beatsPerBar,
      play,
      pressed: held,
      stepAt: step2.on ? step2.at : null,
      loopAt: block.loop,
      scale: scale.kind === 'none' ? null : new Set(SCALES[scale.kind].map((s) => (s + scale.root) % 12)),
      box: frame,
      velLabel: t('roll.velocity'),
      curve: laneInfo ? { points, lo: curveRange({ kind: laneInfo.kind })[0], hi: curveRange({ kind: laneInfo.kind })[1], label: laneLabel(lane) } : null,
      colors: { background: pal.background.default, paper: pal.background.paper, hover: pal.action.hover, divider: pal.divider, text: pal.text.primary, textSecondary: pal.text.secondary, note: pal.primary.main, noteSelected: pal.primary.light, play: pal.error.main, whiteKey: '#e9e9e9', blackKey: '#2b2b2b', keyLine: '#9a9a9a' },
    })
  })
  // 開いたとき、音符のある高さが見えるように縦の位置を決める（音符がなければ C4 の辺り）
  const placed = useRef('')
  useLayoutEffect(() => {
    if (height < 1 || placed.current === block.id) return
    placed.current = block.id
    const ps = block.notes.map((n) => n.pitch)
    const mid = ps.length ? Math.round((Math.min(...ps) + Math.max(...ps)) / 2) : 60
    setLow(mid - Math.floor(rowsOf({ ...viewRef.current, h: height }) / 2))
  }, [block.id, height > 0])
  // 閉じるとき、鳴らしている音を離す
  useEffect(() => () => sound(null), [])
  // 再生位置の線（再生中は毎フレーム、ブロックの頭からの拍にして描き直す）
  useEffect(() => {
    if (!p.playing) return setPlay(null)
    let id = 0
    const tick = () => {
      const m = projectBeatMap(p.project)
      const b = m.toBeat(p.position()) - m.toBeat(block.start)
      setPlay(b >= 0 && b <= len ? b : null)
      id = requestAnimationFrame(tick)
    }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
  }, [p.playing, block.start, len])

  useRollWheel(canvas, viewRef, { zoom: setZoom, left: setLeft, row: setRow, low: setLow })

  const step2 = useStepInput({ notes: block.notes, len, dur: () => lastDur.current || step, onChange: p.onChange, setSelected: setSel })
  const edit = useRollEdit({ notes: block.notes, selected: sel, setSelected: setSel, len, step, left: view.left, onChange: p.onChange, setTool })
  const { remove, onKey } = edit
  const pos = (e: { clientX: number; clientY: number }) => localPoint(canvas.current!, e.clientX, e.clientY)
  const velAt = (y: number) => Math.max(0.02, Math.min(1, 1 - (y - rollHeight(view) - GAP) / VEL))
  const setVelocity = (ids: string[], v: number, merge: string) => p.onChange(block.notes.map((n) => (ids.includes(n.id) ? { ...n, vel: v } : n)), merge)

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { x, y } = pos(e)
    e.currentTarget.setPointerCapture(e.pointerId)
    e.currentTarget.focus()
    touch.current = e.pointerType === 'touch'
    // 2 本目の指: つまみ（拡大と縮小、縦横のスクロール）に切り替える
    if (pinch.down(e, view)) {
      if (drag.current?.kind === 'pan') clearTimeout(drag.current.timer)
      drag.current = null
      setFrame(null)
      sound(null)
      return
    }
    // 鍵盤: 押している間鳴らし、なぞると続けて鳴らす
    if (x < KEYS) {
      if (y < rollHeight(view)) {
        drag.current = { kind: 'key' }
        sound(rowPitch(view, y))
      }
      return
    }
    const merge = `roll${count.current++}`
    // 曲線のレーン: 点を押してドラッグ、空いている所を押して点を足す（右クリックで消す）
    if (y >= rollHeight(view) + GAP && laneInfo) {
      let pts = points
      let index = hitPoint(pts, view, lane, x, y)
      if (index < 0) {
        const t0 = Math.max(0, Math.min(len, e.altKey || !snapOn ? xBeat(view, x) : Math.round(xBeat(view, x) / step) * step))
        pts = [...pts, { t: t0, v: valueAt(view, lane, y) }].sort((a, b) => a.t - b.t)
        index = pts.findIndex((q) => q.t === t0)
        p.onCurves(withPoints(block.curves, lane, pts), merge)
      }
      drag.current = { kind: 'point', index, merge }
      return
    }
    // 強さの帯
    if (y >= rollHeight(view) + GAP) {
      const i = hitVel(block.notes, view, x)
      if (i < 0) return
      const id = block.notes[i].id
      if (!sel.includes(id)) setSel([id])
      drag.current = { kind: 'vel', id, merge }
      setVelocity(sel.includes(id) ? sel : [id], velAt(y), merge)
      return
    }
    const h = hitNote(block.notes, view, x, y, edgePx())
    if (tool === 'erase') {
      drag.current = { kind: 'erase', merge }
      if (h.index >= 0) p.onChange(block.notes.filter((_, i) => i !== h.index), merge)
      return
    }
    if (tool === 'slice') {
      if (h.index >= 0) p.onChange(slice(block.notes, block.notes[h.index].id, snap(xBeat(view, x), e.altKey)))
      return
    }
    if (tool === 'mute') {
      if (h.index < 0) return
      const value = !block.notes[h.index].mute
      drag.current = { kind: 'mute', value, merge }
      p.onChange(setMute(block.notes, [block.notes[h.index].id], value), merge)
      return
    }
    if (h.index >= 0) {
      const n = block.notes[h.index]
      // Shift は選択の足し引き。選んでいないものを押したら、それだけを選ぶ
      let next = sel
      if (e.shiftKey) next = sel.includes(n.id) ? sel.filter((id) => id !== n.id) : [...sel, n.id]
      else if (!sel.includes(n.id)) next = [n.id]
      setSel(next)
      if (!next.includes(n.id)) return
      sound(n.pitch, n.vel)
      const start = block.notes.map((q) => ({ ...q }))
      drag.current = h.edge ? { kind: 'size', start, beat0: xBeat(view, x), merge } : { kind: 'move', start, beat0: xBeat(view, x), pitch0: rowPitch(view, y), merge }
      return
    }
    // 空いている所: ペンなら音符を足して、そのまま長さをドラッグできるようにする。選択なら枠で選ぶ（Shift なら今の選択に足す）
    if (tool === 'pen' && !e.shiftKey) {
      const note = newNote(x, y, e.altKey)
      const notes = [...block.notes, note]
      p.onChange(notes, merge)
      setSel([note.id])
      sound(note.pitch, note.vel)
      drag.current = { kind: 'size', start: notes.map((q) => ({ ...q })), beat0: xBeat(view, x), merge }
      return
    }
    // 指で選択の道具のとき: なぞるとスクロール。動かさずに離すと音符を足し、長押しすると枠で選ぶ
    if (touch.current && !e.shiftKey) {
      const timer = window.setTimeout(() => {
        if (drag.current?.kind !== 'pan' || drag.current.moved) return
        setSel([])
        setFrame({ x0: x, y0: y, x1: x, y1: y })
        drag.current = { kind: 'box', x0: x, y0: y }
      }, 450)
      drag.current = { kind: 'pan', x, y, cx: e.clientX, cy: e.clientY, left0: view.left, low0: view.low, t0: Date.now(), moved: false, timer }
      return
    }
    if (!e.shiftKey) setSel([])
    setFrame({ x0: x, y0: y, x1: x, y1: y })
    drag.current = { kind: 'box', x0: x, y0: y }
  }

  /** 押した所に置く新しい音符（始まりは、押したマスの頭。長さは直前に決めた長さ、なければグリッド 1 つ） */
  const newNote = (x: number, y: number, free: boolean): Note => ({ id: newId(), t: Math.max(0, Math.min(len - step, free || !snapOn ? xBeat(view, x) : Math.floor(xBeat(view, x) / step + 1e-6) * step)), dur: lastDur.current || step, pitch: rowPitch(view, y), vel: 0.8 })

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (pinch.move(e, view)) return
    const d = drag.current
    if (!d) return
    const { x, y } = pos(e)
    if (d.kind === 'pan') {
      const dx = e.clientX - d.cx
      const dy = e.clientY - d.cy
      if (!d.moved && Math.abs(dx) + Math.abs(dy) > 8) {
        d.moved = true
        clearTimeout(d.timer)
      }
      if (d.moved) {
        setLeft(Math.max(0, d.left0 - dx / view.ppb))
        setLow(d.low0 + Math.round(dy / view.row))
      }
      return
    }
    if (d.kind === 'key') {
      if (y >= 0 && y < rollHeight(view)) sound(rowPitch(view, y))
      return
    }
    if (d.kind === 'mute') {
      const h = hitNote(block.notes, view, x, y, edgePx())
      if (h.index >= 0 && !!block.notes[h.index].mute !== d.value) p.onChange(setMute(block.notes, [block.notes[h.index].id], d.value), d.merge)
      return
    }
    if (d.kind === 'erase') {
      const h = hitNote(block.notes, view, x, y)
      if (h.index >= 0) p.onChange(block.notes.filter((_, i) => i !== h.index), d.merge)
      return
    }
    if (d.kind === 'box') {
      setFrame({ x0: d.x0, y0: d.y0, x1: x, y1: y })
      const [xa, xb] = [Math.min(d.x0, x), Math.max(d.x0, x)]
      const [ya, yb] = [Math.min(d.y0, y), Math.max(d.y0, y)]
      setSel(
        block.notes.flatMap((n) => {
          const ny = pitchY(view, n.pitch)
          if (ny === -Infinity) return []
          const nx0 = KEYS + (n.t - view.left) * view.ppb
          const nx1 = nx0 + Math.max(3, n.dur * view.ppb)
          return nx1 >= xa && nx0 <= xb && ny + view.row >= ya && ny <= yb ? [n.id] : []
        }),
      )
      return
    }
    if (d.kind === 'point') {
      // 前後の点は越えない
      const pts = points
      const lo = pts[d.index - 1]?.t ?? 0
      const hi = pts[d.index + 1]?.t ?? len
      const t0 = Math.max(lo, Math.min(hi, e.altKey || !snapOn ? xBeat(view, x) : Math.round(xBeat(view, x) / step) * step))
      p.onCurves(withPoints(block.curves, lane, pts.map((q, i) => (i === d.index ? { t: t0, v: valueAt(view, lane, y) } : q))), d.merge)
      return
    }
    if (d.kind === 'vel') {
      setVelocity(sel.includes(d.id) ? sel : [d.id], velAt(y), d.merge)
      return
    }
    const notes = block.notes.map((n) => ({ ...n }))
    // 選んでいる音符の、動かし始めたときの並びでの番号
    const ix = d.start.flatMap((n, i) => (sel.includes(n.id) ? [i] : []))
    if (!ix.length) return
    if (d.kind === 'move') {
      // 選んだものが全部収まる範囲で動かす（時間は、グリッドに合わせた差で）
      const ds = snap(xBeat(view, x) - d.beat0, e.altKey)
      const dp = rowPitch(view, y) - d.pitch0
      const s = Math.max(Math.max(...ix.map((i) => -d.start[i].t)), Math.min(Math.min(...ix.map((i) => len - d.start[i].dur - d.start[i].t)), ds))
      const pp = Math.max(Math.max(...ix.map((i) => -d.start[i].pitch)), Math.min(Math.min(...ix.map((i) => 127 - d.start[i].pitch)), dp))
      for (const i of ix) notes[i] = { ...d.start[i], t: d.start[i].t + s, pitch: d.start[i].pitch + pp }
      sound(notes[ix[0]].pitch, notes[ix[0]].vel)
    } else {
      const dd = snap(xBeat(view, x) - d.beat0, e.altKey)
      for (const i of ix) {
        const n = d.start[i]
        notes[i] = { ...n, dur: Math.max(step, Math.min(len - n.t, n.dur + dd)) }
      }
      lastDur.current = notes[ix[0]].dur
    }
    p.onChange(notes, d.merge)
  }

  const onUp = (e?: React.PointerEvent<HTMLCanvasElement>) => {
    pinch.up(e)
    const d = drag.current
    // 動かさずに離した指: 音符を足す
    if (d?.kind === 'pan') {
      clearTimeout(d.timer)
      if (!d.moved && Date.now() - d.t0 < 400 && d.y < rollHeight(view)) {
        const note = newNote(d.x, d.y, false)
        p.onChange([...block.notes, note])
        setSel([note.id])
        sound(note.pitch, note.vel)
        setTimeout(() => sounding.current === note.pitch && sound(null), 200)
        drag.current = null
        setFrame(null)
        return
      }
    }
    drag.current = null
    setFrame(null)
    sound(null)
  }
  /** ダブルクリックで、空いている所に音符を足す */
  const onDouble = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = pos(e)
    if (x < KEYS || y >= rollHeight(view) || hitNote(block.notes, view, x, y).index >= 0) return
    const note = newNote(x, y, e.altKey)
    p.onChange([...block.notes, note])
    setSel([note.id])
    sound(note.pitch, note.vel)
    setTimeout(() => sounding.current === note.pitch && sound(null), 200)
  }
  /** 右クリックで、押した音符を消す */
  const onContext = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    const { x, y } = pos(e)
    // 指の長押し: 押した音符のメニュー
    if (touch.current && y < rollHeight(view) && hitNote(block.notes, view, x, y, edgePx()).index >= 0) {
      const n = block.notes[hitNote(block.notes, view, x, y, edgePx()).index]
      if (!sel.includes(n.id)) setSel([n.id])
      drag.current = null
      sound(null)
      return setNoteMenu({ x: e.clientX, y: e.clientY })
    }
    if (laneInfo && y >= rollHeight(view) + GAP) {
      const i = hitPoint(points, view, lane, x, y)
      if (i >= 0) p.onCurves(withPoints(block.curves, lane, points.filter((_, k) => k !== i)))
      return
    }
    const h = hitNote(block.notes, view, x, y)
    if (h.index >= 0) remove([block.notes[h.index].id])
  }
  /** 横の拡大と縮小（見えている中央を動かさない） */
  const zoomBy = (f: number) => {
    const ppb = Math.max(2, Math.min(2000, view.ppb * f))
    const mid = view.left + visibleBeats(view) / 2
    setZoom(ppb)
    setLeft(Math.max(0, mid - visibleBeats({ ...view, ppb }) / 2))
  }
  /** ステップ入力を始める位置: 選んでいる音符の終わり（なければ頭） */
  const stepStart = () => (sel.length ? selectionEnd(block.notes, sel) : 0)
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }} onKeyDown={onKey}>
      {p.toolbar !== false && (
        <RollToolbar
          host={p.chromeHost}
          division={p.division}
          onDivision={p.onDivision}
          snapOn={snapOn}
          onSnap={() => setSnapOn((v) => !v)}
          tool={tool}
          onTool={setTool}
          selectedIds={sel}
          edit={edit}
          canPaste={hasClipboard()}
          playing={p.playing}
          onTogglePlay={() => (p.playing ? p.onTogglePlay() : p.onPlayBlock(loopPlay))}
          loopPlay={loopPlay}
          onLoopPlay={() => setLoopPlay((v) => !v)}
          onSelectAll={() => setSel(block.notes.map((n) => n.id))}
          onZoom={zoomBy}
          onFit={() => (setZoom(null), setLeft(0))}
          preview={preview}
          onPreview={() => setPreview((v) => !v)}
          scale={scale}
          onScale={(root, kind) => setScale({ root, kind })}
          keyboard={kb}
          onKeyboard={() => setKb((v) => !v)}
          fold={fold}
          onFold={() => setFold((v) => !v)}
          stepInput={step2.on}
          onStepInput={() => step2.toggle(stepStart())}
        />
      )}
      <NoteMenu position={noteMenu} onClose={() => setNoteMenu(null)} edit={edit} selected={sel} />
      <InfoLine notes={block.notes} selected={sel} len={len} step={step} onChange={p.onChange} lane={lane} laneLabel={laneLabel} onLane={setLane} />
      <Box sx={{ mx: 1.5 }}>
        <RollRuler view={view} len={len} beatsPerBar={p.project.tempo.beatsPerBar} origin={map.toBeat(block.start)} step={step} play={play} onLength={p.onLength} />
      </Box>
      <Box ref={box} sx={{ flex: '1 1 420px', minHeight: 120, position: 'relative', mx: 1.5 }}>
        <canvas ref={canvas} tabIndex={0} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => onUp()} onDoubleClick={onDouble} onContextMenu={onContext} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none', outline: 'none' }} />
      </Box>
      <Box sx={{ mx: 1.5, mt: 0.5 }}>
      <ScrollBar orientation="horizontal" total={Math.max(len, visibleBeats(view))} start={view.left} size={visibleBeats(view)} onChange={(v) => setLeft(Math.max(0, v))} />
      </Box>
      {kb && (
        <ScreenKeyboard
          base={kbBase}
          onBase={setKbBase}
          onNote={(pitch, vel, on) => {
            if (preview) p.onPreview?.(pitch, vel, on)
            step2.note(pitch, vel, on)
          }}
          stepOn={step2.on}
          onStep={(on) => step2.toggle(stepStart(), on)}
          onRest={step2.rest}
        />
      )}
    </Box>
  )
}
