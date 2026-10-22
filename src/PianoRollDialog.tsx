// ピアノロール（MIDI ブロックの音符を編集する）。空いている所を押すと音符を足し（そのままドラッグで長さ）、音符を押してドラッグで動かし、右端で長さを変え、
// ダブルクリックか Delete で消す。Shift を押しながらクリックで選択の足し引き、Shift を押しながら空いている所をドラッグで枠で選ぶ、Ctrl+A で全部。選んだものは一緒に動く。
// 下の帯は音の強さ（ベロシティ）。棒をドラッグして変える。音符を押したり動かしたりすると、その高さの音を音源で鳴らす
import { useEffect, useRef, useState } from 'react'
import { Box, Button, DialogActions, DialogContent, Typography } from '@mui/material'
import { WindowDialog, localPoint, pevenFont, usePalette } from 'pevenmui'
import { LabeledSelect as Choice } from 'wevocal-lib/react'
import { useT } from './i18n'
import { newId, type MidiBlock, type Note, type Project } from './project'

const KEYS = 44
const ROW = 14
const ROWS = 36
const W = 840
const ROLL = ROW * ROWS
const VEL = 64
const GAP = 6
const H = ROLL + GAP + VEL
const BLACK = new Set([1, 3, 6, 8, 10])
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

type Drag =
  | { kind: 'move'; start: Note[]; sec0: number; pitch0: number; merge: string }
  | { kind: 'size'; start: Note[]; sec0: number; merge: string }
  | { kind: 'vel'; id: string; merge: string }
  | { kind: 'box'; x0: number; y0: number }

export default function PianoRollDialog(p: {
  open: boolean
  project: Project
  block: MidiBlock | null
  onChange: (notes: Note[], merge?: string) => void
  /** 音源で音を鳴らす、離す（音符を押したとき、動かして高さが変わったとき） */
  onPreview?: (pitch: number, vel: number, on: boolean) => void
  onClose: () => void
}) {
  const t = useT()
  const { pal } = usePalette()
  const canvas = useRef<HTMLCanvasElement>(null)
  const block = p.block
  // 表示する一番下の音（スクロールで動かす）、グリッドの細かさ（1 拍の分割）、選んでいる音符の id
  const [low, setLow] = useState(48)
  const [div, setDiv] = useState(4)
  const [sel, setSel] = useState<string[]>([])
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const drag = useRef<Drag | null>(null)
  const count = useRef(0)
  const lastDur = useRef(0)
  // 今鳴らしている音（動かして高さが変わったら、離して鳴らし直す）
  const sounding = useRef<number | null>(null)
  const beat = 60 / p.project.tempo.bpm
  const step = beat / div
  const pps = block ? (W - KEYS) / Math.max(block.length, step * 4) : 1
  const snap = (sec: number) => Math.round(sec / step) * step
  const rowPitch = (y: number) => low + ROWS - 1 - Math.floor(y / ROW)

  const sound = (pitch: number | null, vel = 0.8) => {
    if (sounding.current !== null && sounding.current !== pitch) p.onPreview?.(sounding.current, 0, false)
    if (pitch !== null && sounding.current !== pitch) p.onPreview?.(pitch, vel, true)
    sounding.current = pitch
  }

  const draw = () => {
    const c = canvas.current
    if (!c || !block) return
    const g = c.getContext('2d')!
    c.width = W * devicePixelRatio
    c.height = H * devicePixelRatio
    g.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)
    g.fillStyle = pal.background.default
    g.fillRect(0, 0, W, H)
    g.font = '10px Roboto, sans-serif'
    g.textBaseline = 'middle'
    for (let r = 0; r < ROWS; r++) {
      const pitch = low + ROWS - 1 - r
      const y = r * ROW
      if (BLACK.has(pitch % 12)) {
        g.fillStyle = pal.action.hover
        g.fillRect(KEYS, y, W - KEYS, ROW)
      }
      g.fillStyle = BLACK.has(pitch % 12) ? pal.background.default : pal.background.paper
      g.fillRect(0, y, KEYS - 2, ROW - 1)
      if (pitch % 12 === 0) {
        g.fillStyle = pal.text.primary
        g.fillText(`C${Math.floor(pitch / 12) - 1}`, 4, y + ROW / 2)
      }
    }
    // 縦線（グリッド、拍、小節）
    const bar = beat * p.project.tempo.beatsPerBar
    const near = (v: number, unit: number) => Math.abs(v / unit - Math.round(v / unit)) < 1e-6
    for (let s = 0; s <= block.length + 1e-6; s += step) {
      g.fillStyle = near(s, bar) || near(s, beat) ? pal.divider : pal.action.hover
      g.fillRect(KEYS + s * pps, 0, 1, H)
    }
    // 音符（強さが弱いほど薄く）
    block.notes.forEach((n) => {
      const r = low + ROWS - 1 - n.pitch
      if (r < 0 || r >= ROWS) return
      g.globalAlpha = 0.4 + 0.6 * n.vel
      g.fillStyle = sel.includes(n.id) ? pal.primary.light : pal.primary.main
      g.fillRect(KEYS + n.t * pps, r * ROW + 1, Math.max(3, n.dur * pps), ROW - 2)
      g.globalAlpha = 0.5
      g.fillStyle = pal.text.primary
      g.fillRect(KEYS + (n.t + n.dur) * pps - 2, r * ROW + 1, 2, ROW - 2)
      g.globalAlpha = 1
    })
    // 音の強さの帯
    g.fillStyle = pal.action.hover
    g.fillRect(KEYS, ROLL + GAP, W - KEYS, VEL)
    g.fillStyle = pal.text.secondary
    g.fillText(t('roll.velocity'), 4, ROLL + GAP + 10)
    block.notes.forEach((n) => {
      g.fillStyle = sel.includes(n.id) ? pal.primary.light : pal.primary.main
      g.fillRect(KEYS + n.t * pps, ROLL + GAP + VEL * (1 - n.vel), 3, VEL * n.vel)
    })
    if (box) {
      g.strokeStyle = pal.primary.main
      g.strokeRect(Math.min(box.x0, box.x1), Math.min(box.y0, box.y1), Math.abs(box.x1 - box.x0), Math.abs(box.y1 - box.y0))
    }
  }
  useEffect(draw)
  // 閉じるとき、鳴らしている音を離す
  useEffect(() => () => sound(null), [])

  /** 押した所の音符（なければ -1）と、右端か */
  const hit = (x: number, y: number) => {
    if (!block || y >= ROLL) return { index: -1, edge: false }
    const pitch = rowPitch(y)
    const sec = (x - KEYS) / pps
    const index = block.notes.findLastIndex((n) => n.pitch === pitch && sec >= n.t - 2 / pps && sec <= n.t + n.dur + 2 / pps)
    const n = block.notes[index]
    return { index, edge: !!n && (n.t + n.dur - sec) * pps < 6 }
  }
  /** 強さの帯の、押した所の音符（棒の近く） */
  const hitVel = (x: number) => (block ? block.notes.findLastIndex((n) => Math.abs(KEYS + n.t * pps + 1 - x) < 4) : -1)
  const pos = (e: { clientX: number; clientY: number }) => {
    return localPoint(canvas.current!, e.clientX, e.clientY)
  }
  const velAt = (y: number) => Math.max(0.02, Math.min(1, 1 - (y - ROLL - GAP) / VEL))

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!block) return
    const { x, y } = pos(e)
    if (x < KEYS) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const merge = `roll${count.current++}`
    // 強さの帯
    if (y >= ROLL + GAP) {
      const i = hitVel(x)
      if (i < 0) return
      const id = block.notes[i].id
      if (!sel.includes(id)) setSel([id])
      drag.current = { kind: 'vel', id, merge }
      const v = velAt(y)
      const targets = sel.includes(id) ? sel : [id]
      p.onChange(block.notes.map((n) => (targets.includes(n.id) ? { ...n, vel: v } : n)), merge)
      return
    }
    const h = hit(x, y)
    if (h.index >= 0) {
      const n = block.notes[h.index]
      // Shift は選択の足し引き。選んでいないものを押したら、それだけを選ぶ
      let next = sel
      if (e.shiftKey) next = sel.includes(n.id) ? sel.filter((id) => id !== n.id) : [...sel, n.id]
      else if (!sel.includes(n.id)) next = [n.id]
      setSel(next)
      if (!next.includes(n.id)) return
      sound(n.pitch, n.vel)
      drag.current = h.edge ? { kind: 'size', start: block.notes.map((q) => ({ ...q })), sec0: (x - KEYS) / pps, merge } : { kind: 'move', start: block.notes.map((q) => ({ ...q })), sec0: (x - KEYS) / pps, pitch0: rowPitch(y), merge }
      return
    }
    // 空いている所: Shift なら枠で選ぶ。そうでなければ音符を足して、そのまま長さをドラッグできるようにする
    if (e.shiftKey) {
      setBox({ x0: x, y0: y, x1: x, y1: y })
      drag.current = { kind: 'box', x0: x, y0: y }
      return
    }
    const pitch = rowPitch(y)
    const start = Math.max(0, Math.min(block.length - step, snap((x - KEYS) / pps)))
    const note: Note = { id: newId(), t: start, dur: lastDur.current || step, pitch, vel: 0.8 }
    const notes = [...block.notes, note]
    p.onChange(notes, merge)
    setSel([note.id])
    sound(pitch, note.vel)
    drag.current = { kind: 'size', start: notes.map((q) => ({ ...q })), sec0: (x - KEYS) / pps - note.dur, merge }
  }
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current
    if (!d || !block) return
    const { x, y } = pos(e)
    if (d.kind === 'box') {
      const b = { x0: d.x0, y0: d.y0, x1: x, y1: y }
      setBox(b)
      const xa = Math.min(b.x0, b.x1)
      const xb = Math.max(b.x0, b.x1)
      const ya = Math.min(b.y0, b.y1)
      const yb = Math.max(b.y0, b.y1)
      setSel(
        block.notes.flatMap((n) => {
          const r = low + ROWS - 1 - n.pitch
          const nx0 = KEYS + n.t * pps
          const nx1 = nx0 + Math.max(3, n.dur * pps)
          return r >= 0 && r < ROWS && nx1 >= xa && nx0 <= xb && r * ROW + ROW >= ya && r * ROW <= yb ? [n.id] : []
        }),
      )
      return
    }
    if (d.kind === 'vel') {
      const v = velAt(y)
      const targets = sel.includes(d.id) ? sel : [d.id]
      p.onChange(block.notes.map((n) => (targets.includes(n.id) ? { ...n, vel: v } : n)), d.merge)
      return
    }
    const notes = block.notes.map((n) => ({ ...n }))
    // 選んでいる音符の、動かし始めたときの並びでの番号
    const ix = d.start.flatMap((n, i) => (sel.includes(n.id) ? [i] : []))
    if (d.kind === 'move') {
      // 選んだものが全部収まる範囲で動かす（時間は、グリッドに合わせた差で）
      const ds = snap((x - KEYS) / pps - d.sec0)
      const dp = rowPitch(y) - d.pitch0
      const loS = Math.max(...ix.map((i) => -d.start[i].t))
      const hiS = Math.min(...ix.map((i) => block.length - d.start[i].dur - d.start[i].t))
      const loP = Math.max(...ix.map((i) => -d.start[i].pitch))
      const hiP = Math.min(...ix.map((i) => 127 - d.start[i].pitch))
      const s = Math.max(loS, Math.min(hiS, ds))
      const pp = Math.max(loP, Math.min(hiP, dp))
      for (const i of ix) notes[i] = { ...d.start[i], t: d.start[i].t + s, pitch: d.start[i].pitch + pp }
      const lead = notes[ix[0]]
      if (lead) sound(lead.pitch, lead.vel)
    } else {
      const dd = snap((x - KEYS) / pps - d.sec0)
      for (const i of ix) {
        const n = d.start[i]
        notes[i] = { ...n, dur: Math.max(step, Math.min(block.length - n.t, n.dur + dd)) }
      }
      const lead = notes[ix[0]]
      if (lead) lastDur.current = lead.dur
    }
    p.onChange(notes, d.merge)
  }
  const onUp = () => {
    drag.current = null
    setBox(null)
    sound(null)
  }
  const remove = (ids: string[]) => {
    if (!block || !ids.length) return
    p.onChange(block.notes.filter((n) => !ids.includes(n.id)))
    setSel([])
  }
  const onDouble = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = pos(e)
    const h = hit(x, y)
    if (h.index >= 0 && block) remove([block.notes[h.index].id])
  }
  const onKey = (e: React.KeyboardEvent) => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel.length) {
      e.preventDefault()
      remove(sel)
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && block) {
      e.preventDefault()
      setSel(block.notes.map((n) => n.id))
    }
  }
  const onWheel = (e: React.WheelEvent) => setLow((v) => Math.max(0, Math.min(127 - ROWS + 1, v + (e.deltaY > 0 ? -2 : 2))))

  return (
    <WindowDialog open={p.open} onClose={p.onClose} title={t('roll.title')} name="pianoRoll" width={900} height={720} dialogProps={{ fullWidth: true, maxWidth: 'md' }}>
      <DialogContent onKeyDown={onKey}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
          <Box sx={{ width: 140 }}>
            <Choice label={t('roll.grid')} value={div} options={[[1, '1/4'], [2, '1/8'], [4, '1/16'], [8, '1/32']]} onChange={setDiv} />
          </Box>
          <Typography sx={{ fontSize: pevenFont('sm'), color: 'text.secondary' }}>{t('roll.help')}</Typography>
        </Box>
        <canvas ref={canvas} tabIndex={0} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onDoubleClick={onDouble} onWheel={onWheel} style={{ width: W, height: H, maxWidth: '100%', touchAction: 'none', display: 'block' }} />
        <Typography sx={{ fontSize: pevenFont('sm'), color: 'text.secondary', mt: 0.5 }}>
          {NAMES[low % 12]}
          {Math.floor(low / 12) - 1} 〜　{sel.length ? t('roll.selected', { n: sel.length }) : ''}
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button size="small" onClick={p.onClose}>
          {t('common.close')}
        </Button>
      </DialogActions>
    </WindowDialog>
  )
}
