// ピアノロールの本体（MIDI ブロックの音符を編集する）。ダイアログの枠は PianoRollDialog.tsx。
// 空いている所を押すと音符を足し（そのままドラッグで長さ）、音符を押してドラッグで動かし、右端で長さを変え、ダブルクリックか Delete で消す。
// Shift を押しながらクリックで選択の足し引き、Shift を押しながら空いている所をドラッグで枠で選ぶ、Ctrl+A で全部。選んだものは一緒に動く。
// 左の鍵盤を押すと、その高さの音が鳴る。道具（選択、ペン、消しゴム）、ズーム、再生はこの中のツールバーにある（別のウィンドウに出しても使えるよう）。操作の説明は右上の ? のツールチップ（roll.help）。下の帯は音の強さ（ベロシティ）。Ctrl+ホイールで横の拡大、Shift+ホイールで横のスクロール、Alt+ホイールで行の高さ、ホイールで音の高さをずらす。Alt を押している間はグリッドに合わせない
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Box, Typography } from '@mui/material'
import { NumberInput, ScrollBar, localPoint, pevenFont, useBoxSize, usePalette } from 'pevenmui'
import { blockBeats, projectBeatMap } from '../beats'
import { useT } from '../i18n'
import { newId, type MidiBlock, type Note, type Project } from '../project'
import { drawRoll } from './draw'
import RollToolbar, { type HumanizeForm, type QuantizeForm, type Tool } from './Toolbar'
import { copyNotes, glue, humanize, legato, pasteNotes, quantize, resize, selectionEnd, setDuration, setMute, shift, slice, velocity, type NoteClip } from './edit'
import { hitNote, hitVel } from './hit'
import { GAP, KEYS, NAMES, ROW_MAX, ROW_MIN, VEL, clampView, rollHeight, rowPitch, rowsOf, pitchY, stepOf, visibleBeats, xBeat } from './view'

type Drag =
  | { kind: 'move'; start: Note[]; beat0: number; pitch0: number; merge: string }
  | { kind: 'size'; start: Note[]; beat0: number; merge: string }
  | { kind: 'vel'; id: string; merge: string }
  | { kind: 'box'; x0: number; y0: number }
  | { kind: 'key' }
  | { kind: 'erase'; merge: string }
  | { kind: 'mute'; value: boolean; merge: string }


/** キーでの道具の切り替え（FL Studio にならう） */
const TOOL_KEYS: Record<string, Tool> = { e: 'select', p: 'pen', d: 'erase', c: 'slice', t: 'mute' }

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
  /** 再生と一時停止の切り替え（別のウィンドウでも、ピアノロールの中で操作できるように） */
  onTogglePlay: () => void
  /** 専用のツールバーを出すか（既定は出す）。メイン画面のドックに置くときは、既存のツールバーを使うので出さない */
  toolbar?: boolean
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
  // グリッドに合わせる（Alt を押している間は逆）
  const [snapOn, setSnapOn] = useState(true)
  const [tool, setTool] = useState<Tool>('select')
  const [frame, setFrame] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const [play, setPlay] = useState<number | null>(null)
  // 鳴らしている音（鍵盤の色付け）
  const [held, setHeld] = useState<number | null>(null)
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
  const snap = (beat: number, free: boolean) => (free || !snapOn ? beat : Math.round(beat / step) * step)

  const sound = (pitch: number | null, vel = 0.8) => {
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
      box: frame,
      velLabel: t('roll.velocity'),
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
    e.currentTarget.setPointerCapture(e.pointerId)
    e.currentTarget.focus()
    // 鍵盤: 押している間鳴らし、なぞると続けて鳴らす
    if (x < KEYS) {
      if (y < rollHeight(view)) {
        drag.current = { kind: 'key' }
        sound(rowPitch(view, y))
      }
      return
    }
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
    if (!e.shiftKey) setSel([])
    setFrame({ x0: x, y0: y, x1: x, y1: y })
    drag.current = { kind: 'box', x0: x, y0: y }
  }

  /** 押した所に置く新しい音符（長さは直前に決めた長さ、なければグリッド 1 つ） */
  const newNote = (x: number, y: number, free: boolean): Note => ({ id: newId(), t: Math.max(0, Math.min(len - step, snap(xBeat(view, x), free))), dur: lastDur.current || step, pitch: rowPitch(view, y), vel: 0.8 })

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current
    if (!d) return
    const { x, y } = pos(e)
    if (d.kind === 'key') {
      if (y >= 0 && y < rollHeight(view)) sound(rowPitch(view, y))
      return
    }
    if (d.kind === 'mute') {
      const h = hitNote(block.notes, view, x, y)
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
  /** ダブルクリックで、空いている所に音符を足す */
  const onDouble = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = pos(e)
    if (x < KEYS || y >= rollHeight(view) || hitNote(block.notes, view, x, y).index >= 0) return
    const note = newNote(x, y, e.altKey)
    p.onChange([...block.notes, note])
    setSel([note.id])
    sound(note.pitch, note.vel)
    setTimeout(() => sound(null), 200)
  }
  /** 右クリックで、押した音符を消す */
  const onContext = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    const { x, y } = pos(e)
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
  /** グリッドに寄せる（始まりと長さを 100%） */
  const doQuantize = (f: QuantizeForm = { start: true, length: true, strength: 100, swing: 0 }) => sel.length && p.onChange(quantize(block.notes, sel, { step, start: f.start, length: f.length, strength: f.strength / 100, swing: f.swing / 100 }, len))
  const doHumanize = (f: HumanizeForm) => sel.length && p.onChange(humanize(block.notes, sel, { time: f.time / 100, vel: f.vel / 100 }, len))
  const doGlue = () => sel.length > 1 && p.onChange(glue(block.notes, sel))
  const doLegato = () => sel.length && p.onChange(legato(block.notes, sel))
  const doTranspose = (semis: number) => sel.length && p.onChange(shift(block.notes, sel, 0, semis, len))
  const doCopy = (cut: boolean) => {
    clipboard = copyNotes(block.notes, sel) ?? clipboard
    if (cut) remove(sel)
  }
  /** 貼り付け: 選んでいる音符の終わりの次（選んでいなければ見えている左端）へ */
  const doPaste = () => {
    if (!clipboard) return
    const at = sel.length ? selectionEnd(block.notes, sel) : Math.round(view.left / step) * step
    const r = pasteNotes(block.notes, clipboard, at, len)
    p.onChange(r.notes)
    setSel(r.added)
  }
  const doDuplicate = () => {
    doCopy(false)
    doPaste()
  }
  const onKey = (e: React.KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey
    const key = e.key.toLowerCase()
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel.length) remove(sel)
    else if (mod && key === 'a') setSel(block.notes.map((n) => n.id))
    else if (mod && (key === 'c' || key === 'x')) doCopy(key === 'x')
    else if (mod && key === 'v') doPaste()
    else if (mod && key === 'd') doDuplicate()
    else if (mod && key === 'g') doGlue()
    else if (!mod && key === 'q') doQuantize()
    else if (!mod && TOOL_KEYS[key]) setTool(TOOL_KEYS[key])
    else if (!mod && sel.length && e.key.startsWith('Arrow')) {
      const dir = e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 1
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') p.onChange(e.shiftKey ? resize(block.notes, sel, dir * step, len) : shift(block.notes, sel, dir * step, 0, len))
      else doTranspose(dir * (e.shiftKey ? 12 : 1))
    } else return
    e.preventDefault()
  }
  const options: [number, string][] = (DIVISIONS.includes(p.division) ? DIVISIONS : [...DIVISIONS, p.division]).map((d) => [d, `1/${d}`])
  const top = NAMES[view.low % 12] + (Math.floor(view.low / 12) - 1)
  // 情報行: 選んだ音符の値（複数のときは先頭の値）を数値で見て直す。入れた値は選んだ全部に反映する
  const lead = block.notes.find((n) => sel.includes(n.id))
  const field = (label: string, value: number, min: number, max: number, step: number, unit: string, apply: (v: number) => Note[]) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      <Typography sx={{ fontSize: pevenFont('sm'), color: 'text.secondary' }}>{label}</Typography>
      <NumberInput value={Math.round(value * 1000) / 1000} onChange={(v) => p.onChange(apply(v), `info:${label}`)} min={min} max={max} step={step} unit={unit} width={96} disabled={!lead} ariaLabel={label} />
    </Box>
  )
  const info = (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
      {field(t('roll.start'), lead?.t ?? 0, 0, len, step, t('roll.beatUnit'), (v) => shift(block.notes, sel, v - (lead?.t ?? 0), 0, len))}
      {field(t('roll.length'), lead?.dur ?? 0, 1 / 64, len, step, t('roll.beatUnit'), (v) => setDuration(block.notes, sel, v, len))}
      {field(t('roll.pitch'), lead?.pitch ?? 60, 0, 127, 1, '', (v) => shift(block.notes, sel, 0, v - (lead?.pitch ?? 60), len))}
      {field(t('roll.velocity'), Math.round((lead?.vel ?? 0.8) * 127), 1, 127, 1, '', (v) => velocity(block.notes, sel, 'set', v / 127))}
      {lead && <Typography sx={{ fontSize: pevenFont('sm'), color: 'text.secondary' }}>{`${NAMES[lead.pitch % 12]}${Math.floor(lead.pitch / 12) - 1}`}</Typography>}
    </Box>
  )
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1, minHeight: 0 }} onKeyDown={onKey}>
      {p.toolbar !== false && (
        <RollToolbar
          division={p.division}
          divisions={options}
          onDivision={p.onDivision}
          snapOn={snapOn}
          onSnap={() => setSnapOn((v) => !v)}
          tool={tool}
          onTool={setTool}
          selected={sel.length}
          canPaste={!!clipboard}
          playing={p.playing}
          onTogglePlay={p.onTogglePlay}
          onCut={() => doCopy(true)}
          onCopy={() => doCopy(false)}
          onPaste={doPaste}
          onDuplicate={doDuplicate}
          onRemove={() => remove(sel)}
          onTranspose={doTranspose}
          onQuantize={doQuantize}
          onLegato={doLegato}
          onGlue={doGlue}
          onHumanize={doHumanize}
          onZoom={zoomBy}
          onFit={() => (setZoom(null), setLeft(0))}
        />
      )}
      {info}
      <Box ref={box} sx={{ flex: '1 1 420px', minHeight: 260, position: 'relative' }}>
        <canvas ref={canvas} tabIndex={0} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onDoubleClick={onDouble} onContextMenu={onContext} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none', outline: 'none' }} />
      </Box>
      <ScrollBar orientation="horizontal" total={Math.max(len, visibleBeats(view))} start={view.left} size={visibleBeats(view)} onChange={(v) => setLeft(Math.max(0, v))} />
      <Typography sx={{ fontSize: pevenFont('sm'), color: 'text.secondary' }}>
        {top} 〜　{sel.length ? t('roll.selected', { n: sel.length }) : ''}
      </Typography>
    </Box>
  )
}
