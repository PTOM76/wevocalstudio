// ピアノロール（MIDI ブロックの音符を編集する）。空いている所を押すと音符を足し（そのままドラッグで長さ）、音符を押してドラッグで動かし、右端で長さを変え、
// ダブルクリックか Delete で消す。時間はブロックの頭から、グリッドは拍の分割に合わせる
import { useEffect, useRef, useState } from 'react'
import { Box, Button, DialogActions, DialogContent, Typography } from '@mui/material'
import { WindowDialog, pevenFont, usePalette } from 'pevenmui'
import { LabeledSelect as Choice } from 'wevocal-lib/react'
import { useT } from './i18n'
import type { MidiBlock, Note, Project } from './project'

const KEYS = 44
const ROW = 14
const ROWS = 36
const W = 840
const H = ROW * ROWS
const BLACK = new Set([1, 3, 6, 8, 10])
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

type Drag = { kind: 'move' | 'size'; index: number; dt: number; dp: number; merge: string }

export default function PianoRollDialog(p: { open: boolean; project: Project; block: MidiBlock | null; onChange: (notes: Note[], merge?: string) => void; onClose: () => void }) {
  const t = useT()
  const { pal } = usePalette()
  const canvas = useRef<HTMLCanvasElement>(null)
  const block = p.block
  // 表示する一番下の音（スクロールで動かす）と、グリッドの細かさ（1 拍の分割）
  const [low, setLow] = useState(48)
  const [div, setDiv] = useState(4)
  const [sel, setSel] = useState<number | null>(null)
  const drag = useRef<Drag | null>(null)
  const count = useRef(0)
  const lastDur = useRef(0)
  const beat = 60 / p.project.tempo.bpm
  const step = beat / div
  const pps = block ? (W - KEYS) / Math.max(block.length, step * 4) : 1
  const snap = (sec: number) => Math.round(sec / step) * step

  const draw = () => {
    const c = canvas.current
    if (!c || !block) return
    const g = c.getContext('2d')!
    c.width = W * devicePixelRatio
    c.height = H * devicePixelRatio
    g.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)
    g.fillStyle = pal.background.default
    g.fillRect(0, 0, W, H)
    // 行（黒鍵は暗く）と鍵盤
    g.font = '10px Roboto, sans-serif'
    g.textBaseline = 'middle'
    for (let r = 0; r < ROWS; r++) {
      const pitch = low + ROWS - 1 - r
      const y = r * ROW
      g.fillStyle = BLACK.has(pitch % 12) ? pal.action.hover : 'transparent'
      g.fillRect(KEYS, y, W - KEYS, ROW)
      g.fillStyle = BLACK.has(pitch % 12) ? pal.text.disabled : pal.text.secondary
      g.fillRect(0, y, KEYS - 2, ROW - 1)
      g.fillStyle = BLACK.has(pitch % 12) ? pal.background.default : pal.background.paper
      g.fillRect(0, y, KEYS - 2, ROW - 1)
      if (pitch % 12 === 0) {
        g.fillStyle = pal.text.primary
        g.fillText(`C${Math.floor(pitch / 12) - 1}`, 4, y + ROW / 2)
      }
    }
    // 縦線（拍と、グリッド）。小節の頭は濃く
    const bar = beat * p.project.tempo.beatsPerBar
    for (let s = 0; s <= block.length + 1e-6; s += step) {
      const x = KEYS + s * pps
      const strong = Math.abs((s / bar) % 1) < 1e-6 || Math.abs((s / bar) % 1 - 1) < 1e-6
      g.fillStyle = strong ? pal.divider : Math.abs((s / beat) % 1) < 1e-6 || Math.abs((s / beat) % 1 - 1) < 1e-6 ? pal.divider : pal.action.hover
      g.fillRect(x, 0, 1, H)
    }
    // 音符
    block.notes.forEach((n, i) => {
      const r = low + ROWS - 1 - n.pitch
      if (r < 0 || r >= ROWS) return
      g.fillStyle = i === sel ? pal.primary.light : pal.primary.main
      g.fillRect(KEYS + n.t * pps, r * ROW + 1, Math.max(3, n.dur * pps), ROW - 2)
      g.globalAlpha = 0.5
      g.fillStyle = pal.text.primary
      g.fillRect(KEYS + (n.t + n.dur) * pps - 2, r * ROW + 1, 2, ROW - 2)
      g.globalAlpha = 1
    })
  }
  useEffect(draw)

  /** 押した所の音符（なければ -1）と、右端か */
  const hit = (x: number, y: number) => {
    if (!block) return { index: -1, edge: false }
    const pitch = low + ROWS - 1 - Math.floor(y / ROW)
    const sec = (x - KEYS) / pps
    const index = block.notes.findLastIndex((n) => n.pitch === pitch && sec >= n.t - 2 / pps && sec <= n.t + n.dur + 2 / pps)
    const n = block.notes[index]
    return { index, edge: !!n && (n.t + n.dur - sec) * pps < 6 }
  }
  const pos = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!block) return
    const { x, y } = pos(e)
    if (x < KEYS) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const merge = `roll${count.current++}`
    const h = hit(x, y)
    if (h.index >= 0) {
      const n = block.notes[h.index]
      setSel(h.index)
      drag.current = { kind: h.edge ? 'size' : 'move', index: h.index, dt: (x - KEYS) / pps - n.t, dp: 0, merge }
      return
    }
    // 空いている所: 音符を足して、そのまま長さをドラッグできるようにする
    const pitch = low + ROWS - 1 - Math.floor(y / ROW)
    const start = Math.max(0, Math.min(block.length - step, snap((x - KEYS) / pps)))
    const note: Note = { t: start, dur: lastDur.current || step, pitch, vel: 0.8 }
    const notes = [...block.notes, note]
    p.onChange(notes, merge)
    setSel(notes.length - 1)
    drag.current = { kind: 'size', index: notes.length - 1, dt: 0, dp: 0, merge }
  }
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current
    if (!d || !block) return
    const { x, y } = pos(e)
    const n = block.notes[d.index]
    if (!n) return
    const notes = [...block.notes]
    if (d.kind === 'move') {
      const pitch = Math.max(0, Math.min(127, low + ROWS - 1 - Math.floor(y / ROW)))
      notes[d.index] = { ...n, t: Math.max(0, Math.min(block.length - n.dur, snap((x - KEYS) / pps - d.dt))), pitch }
    } else {
      const dur = Math.max(step, snap((x - KEYS) / pps - n.t) || step)
      lastDur.current = dur
      notes[d.index] = { ...n, dur: Math.min(dur, block.length - n.t) }
    }
    p.onChange(notes, d.merge)
  }
  const onUp = () => {
    drag.current = null
  }
  const remove = (i: number) => {
    if (!block) return
    p.onChange(block.notes.filter((_, k) => k !== i))
    setSel(null)
  }
  const onDouble = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = canvas.current!.getBoundingClientRect()
    const h = hit(e.clientX - r.left, e.clientY - r.top)
    if (h.index >= 0) remove(h.index)
  }
  const onKey = (e: React.KeyboardEvent) => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel !== null) {
      e.preventDefault()
      remove(sel)
    }
  }
  const onWheel = (e: React.WheelEvent) => setLow((v) => Math.max(0, Math.min(127 - ROWS + 1, v + (e.deltaY > 0 ? -2 : 2))))

  return (
    <WindowDialog open={p.open} onClose={p.onClose} title={t('roll.title')} name="pianoRoll" width={900} height={640} dialogProps={{ fullWidth: true, maxWidth: 'md' }}>
      <DialogContent onKeyDown={onKey}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
          <Box sx={{ width: 140 }}>
            <Choice label={t('roll.grid')} value={div} options={[[1, '1/4'], [2, '1/8'], [4, '1/16'], [8, '1/32']]} onChange={setDiv} />
          </Box>
          <Typography sx={{ fontSize: pevenFont('sm'), color: 'text.secondary' }}>{t('roll.help')}</Typography>
        </Box>
        <canvas ref={canvas} tabIndex={0} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onDoubleClick={onDouble} onWheel={onWheel} style={{ width: W, height: H, maxWidth: '100%', touchAction: 'none', display: 'block' }} />
        <Typography sx={{ fontSize: pevenFont('sm'), color: 'text.secondary', mt: 0.5 }}>{NAMES[low % 12]}{Math.floor(low / 12) - 1} 〜</Typography>
      </DialogContent>
      <DialogActions>
        <Button size="small" onClick={p.onClose}>
          {t('common.close')}
        </Button>
      </DialogActions>
    </WindowDialog>
  )
}
