// ピアノロールの本体（MIDI ブロックの音符を編集する）。ダイアログの枠は PianoRollDialog.tsx。
// 空いている所を押すと音符を足し（そのままドラッグで長さ）、音符を押してドラッグで動かし、右端で長さを変え、ダブルクリックか Delete で消す。
// Shift を押しながらクリックで選択の足し引き、Shift を押しながら空いている所をドラッグで枠で選ぶ、Ctrl+A で全部。選んだものは一緒に動く。
// 下の帯は音の強さ（ベロシティ）。Ctrl+ホイールで横の拡大、Shift+ホイールで横のスクロール、Alt+ホイールで行の高さ、ホイールで音の高さをずらす。Alt を押している間はグリッドに合わせない
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Box, Button, Typography } from '@mui/material'
import { ScrollBar, localPoint, pevenFont, useBoxSize, usePalette } from 'pevenmui'
import { LabeledSelect as Choice } from 'wevocal-lib/react'
import { blockBeats, projectBeatMap } from '../beats'
import { useT } from '../i18n'
import { newId, type MidiBlock, type Note, type Project } from '../project'
import { drawRoll } from './draw'
import { copyNotes, legato, pasteNotes, quantize, resize, selectionEnd, shift, type NoteClip } from './edit'
import { hitNote, hitVel } from './hit'
import { GAP, KEYS, NAMES, ROW_MAX, ROW_MIN, VEL, clampView, rollHeight, rowPitch, rowsOf, pitchY, stepOf, visibleBeats, xBeat } from './view'

type Drag =
  | { kind: 'move'; start: Note[]; beat0: number; pitch0: number; merge: string }
  | { kind: 'size'; start: Note[]; beat0: number; merge: string }
  | { kind: 'vel'; id: string; merge: string }
  | { kind: 'box'; x0: number; y0: number }

/** コピーした音符（ピアノロールを閉じても残す） */
let clipboard: NoteClip | null = null

/** グリッドの選択肢（時間軸の細かさと同じ値。ここにない値のときは足す） */
const DIVISIONS = [1, 2, 4, 8, 16, 32, 64, 128, 256, 3, 6, 12, 24]

export interface PianoRollProps {
  project: Project
  block: MidiBlock
  /** グリッドの細かさ（時間軸と同じ設定） */
  division: number
  onDivision: (division: number) => void
  onChange: (notes: Note[], merge?: string) => void
  /** 音源で音を鳴らす、離す（音符を押したとき、動かして高さが変わったとき） */
  onPreview?: (pitch: number, vel: number, on: boolean) => void
  /** 再生中か、再生位置（秒）。再生位置の線を描く */
  playing: boolean
  position: () => number
}

export default function PianoRoll(p: PianoRollProps) {
  const t = useT()
  const { pal } = usePalette()
  const canvas = useRef<HTMLCanvasElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const { width, height } = useBoxSize(box)
  const { block } = p
  // 表示の位置: 左端の拍、1 拍の幅（null はブロック全体が収まる幅）、一番下の音、1 行の高さ
  const [left, setLeft] = useState(0)
  const [zoom, setZoom] = useState<number | null>(null)
  const [low, setLow] = useState(48)
  const [row, setRow] = useState(14)
  const [sel, setSel] = useState<string[]>([])
  const [frame, setFrame] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const [play, setPlay] = useState<number | null>(null)
  const drag = useRef<Drag | null>(null)
  const count = useRef(0)
  const lastDur = useRef(0)
  // 今鳴らしている音（動かして高さが変わったら、離して鳴らし直す）
  const sounding = useRef<number | null>(null)
  const step = stepOf(p.division)
  const map = projectBeatMap(p.project)
  const len = blockBeats(map, block)
  const fit = Math.max(1, (width - KEYS) / Math.max(len, step * 4))
  const view = clampView({ left, ppb: zoom ?? fit, low, row, w: width, h: height }, len)
  const viewRef = useRef(view)
  viewRef.current = view
  const snap = (beat: number, free: boolean) => (free ? beat : Math.round(beat / step) * step)

  const sound = (pitch: number | null, vel = 0.8) => {
    if (sounding.current !== null && sounding.current !== pitch) p.onPreview?.(sounding.current, 0, false)
    if (pitch !== null && sounding.current !== pitch) p.onPreview?.(pitch, vel, true)
    sounding.current = pitch
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
      box: frame,
      velLabel: t('roll.velocity'),
      colors: { background: pal.background.default, paper: pal.background.paper, hover: pal.action.hover, divider: pal.divider, text: pal.text.primary, textSecondary: pal.text.secondary, note: pal.primary.main, noteSelected: pal.primary.light, play: pal.error.main },
    })
  })
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

  // ホイール: Ctrl で横の拡大（マウスの位置を動かさない）、Shift で横のスクロール、Alt で行の高さ、そのままで音の高さ。ページごと動かないよう passive にしない
  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const v = viewRef.current
      const dir = e.deltaY > 0 ? 1 : -1
      if (e.ctrlKey) {
        const at = localPoint(el, e.clientX, e.clientY).x
        const ppb = Math.max(2, Math.min(2000, v.ppb * (dir > 0 ? 0.85 : 1 / 0.85)))
        const beat = xBeat(v, at)
        setZoom(ppb)
        setLeft(Math.max(0, beat - (at - KEYS) / ppb))
      } else if (e.shiftKey) setLeft(Math.max(0, v.left + (dir * 60) / v.ppb))
      else if (e.altKey) setRow(Math.max(ROW_MIN, Math.min(ROW_MAX, v.row - dir)))
      else setLow(v.low - dir * 2)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const pos = (e: { clientX: number; clientY: number }) => localPoint(canvas.current!, e.clientX, e.clientY)
  const velAt = (y: number) => Math.max(0.02, Math.min(1, 1 - (y - rollHeight(view) - GAP) / VEL))
  const setVelocity = (ids: string[], v: number, merge: string) => p.onChange(block.notes.map((n) => (ids.includes(n.id) ? { ...n, vel: v } : n)), merge)

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { x, y } = pos(e)
    if (x < KEYS) return
    e.currentTarget.setPointerCapture(e.pointerId)
    e.currentTarget.focus()
    const merge = `roll${count.current++}`
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
    const h = hitNote(block.notes, view, x, y)
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
    // 空いている所: Shift なら枠で選ぶ。そうでなければ音符を足して、そのまま長さをドラッグできるようにする
    if (e.shiftKey) {
      setFrame({ x0: x, y0: y, x1: x, y1: y })
      drag.current = { kind: 'box', x0: x, y0: y }
      return
    }
    const pitch = rowPitch(view, y)
    const dur = lastDur.current || step
    const note: Note = { id: newId(), t: Math.max(0, Math.min(len - step, snap(xBeat(view, x), e.altKey))), dur, pitch, vel: 0.8 }
    const notes = [...block.notes, note]
    p.onChange(notes, merge)
    setSel([note.id])
    sound(pitch, note.vel)
    drag.current = { kind: 'size', start: notes.map((q) => ({ ...q })), beat0: xBeat(view, x) - dur, merge }
  }

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current
    if (!d) return
    const { x, y } = pos(e)
    if (d.kind === 'box') {
      setFrame({ x0: d.x0, y0: d.y0, x1: x, y1: y })
      const [xa, xb] = [Math.min(d.x0, x), Math.max(d.x0, x)]
      const [ya, yb] = [Math.min(d.y0, y), Math.max(d.y0, y)]
      const rows = rowsOf(view)
      setSel(
        block.notes.flatMap((n) => {
          if (n.pitch < view.low || n.pitch >= view.low + rows) return []
          const ny = pitchY(view, n.pitch)
          const nx0 = KEYS + (n.t - view.left) * view.ppb
          const nx1 = nx0 + Math.max(3, n.dur * view.ppb)
          return nx1 >= xa && nx0 <= xb && ny + view.row >= ya && ny <= yb ? [n.id] : []
        }),
      )
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

  const onUp = () => {
    drag.current = null
    setFrame(null)
    sound(null)
  }
  const remove = (ids: string[]) => {
    if (!ids.length) return
    p.onChange(block.notes.filter((n) => !ids.includes(n.id)))
    setSel([])
  }
  const onDouble = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = pos(e)
    const h = hitNote(block.notes, view, x, y)
    if (h.index >= 0) remove([block.notes[h.index].id])
  }
  /** グリッドに寄せる（始まりと長さを 100%） */
  const doQuantize = () => sel.length && p.onChange(quantize(block.notes, sel, { step, start: true, length: true, strength: 1, swing: 0 }, len))
  const doLegato = () => sel.length && p.onChange(legato(block.notes, sel))
  /** 貼り付け: 選んでいる音符の終わりの次（選んでいなければ見えている左端）へ */
  const doPaste = () => {
    if (!clipboard) return
    const at = sel.length ? selectionEnd(block.notes, sel) : Math.round(view.left / step) * step
    const r = pasteNotes(block.notes, clipboard, at, len)
    p.onChange(r.notes)
    setSel(r.added)
  }
  const onKey = (e: React.KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey
    const key = e.key.toLowerCase()
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel.length) remove(sel)
    else if (mod && key === 'a') setSel(block.notes.map((n) => n.id))
    else if (mod && (key === 'c' || key === 'x')) {
      clipboard = copyNotes(block.notes, sel) ?? clipboard
      if (key === 'x') remove(sel)
    } else if (mod && key === 'v') doPaste()
    else if (mod && key === 'd') {
      clipboard = copyNotes(block.notes, sel) ?? clipboard
      doPaste()
    } else if (!mod && key === 'q') doQuantize()
    else if (!mod && sel.length && e.key.startsWith('Arrow')) {
      const dir = e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 1
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') p.onChange(e.shiftKey ? resize(block.notes, sel, dir * step, len) : shift(block.notes, sel, dir * step, 0, len))
      else p.onChange(shift(block.notes, sel, 0, dir * (e.shiftKey ? 12 : 1), len))
    } else return
    e.preventDefault()
  }
  const options: [number, string][] = (DIVISIONS.includes(p.division) ? DIVISIONS : [...DIVISIONS, p.division]).map((d) => [d, `1/${d}`])
  const top = NAMES[view.low % 12] + (Math.floor(view.low / 12) - 1)

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1, minHeight: 0 }} onKeyDown={onKey}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <Box sx={{ width: 140 }}>
          <Choice label={t('roll.grid')} value={p.division} options={options} onChange={p.onDivision} />
        </Box>
        <Button size="small" disabled={!sel.length} onClick={doQuantize}>
          {t('roll.quantize')}
        </Button>
        <Button size="small" disabled={!sel.length} onClick={doLegato}>
          {t('roll.legato')}
        </Button>
      </Box>
      <Typography sx={{ fontSize: pevenFont('sm'), color: 'text.secondary' }}>{t('roll.help')}</Typography>
      <Box ref={box} sx={{ flex: '1 1 420px', minHeight: 260, position: 'relative' }}>
        <canvas ref={canvas} tabIndex={0} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onDoubleClick={onDouble} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none', outline: 'none' }} />
      </Box>
      <ScrollBar orientation="horizontal" total={Math.max(len, visibleBeats(view))} start={view.left} size={visibleBeats(view)} onChange={(v) => setLeft(Math.max(0, v))} />
      <Typography sx={{ fontSize: pevenFont('sm'), color: 'text.secondary' }}>
        {top} 〜　{sel.length ? t('roll.selected', { n: sel.length }) : ''}
      </Typography>
    </Box>
  )
}
