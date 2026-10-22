// ピアノロールの編集の操作（消す、コピーと貼り付け、複製、移調、クオンタイズ、接着など）と、そのキー操作
import type { KeyboardEvent } from 'react'
import type { Note } from '../project'
import { copyNotes, glue, humanize, legato, pasteNotes, quantize, resize, selectionEnd, shift, type NoteClip } from './edit'
import type { HumanizeForm, QuantizeForm, Tool } from './Toolbar'

/** 道具のキー（FL Studio にならう） */
const TOOL_KEYS: Record<string, Tool> = { e: 'select', p: 'pen', d: 'erase', c: 'slice', t: 'mute' }

/** コピーした音符（ピアノロールを閉じても残す） */
let clipboard: NoteClip | null = null
export const hasClipboard = () => !!clipboard

export function useRollEdit(o: {
  notes: Note[]
  selected: string[]
  setSelected: (ids: string[]) => void
  /** ブロックの長さ（拍）、グリッドの間隔（拍）、見えている左端（拍） */
  len: number
  step: number
  left: number
  onChange: (notes: Note[], merge?: string) => void
  setTool: (tool: Tool) => void
}) {
  const { notes, selected: sel, len, step } = o
  const remove = (ids: string[]) => {
    if (!ids.length) return
    o.onChange(notes.filter((n) => !ids.includes(n.id)))
    o.setSelected([])
  }
  /** グリッドに寄せる（既定は始まりと長さを 100%） */
  const quantizeSel = (f: QuantizeForm = { start: true, length: true, strength: 100, swing: 0 }) =>
    sel.length && o.onChange(quantize(notes, sel, { step, start: f.start, length: f.length, strength: f.strength / 100, swing: f.swing / 100 }, len))
  const humanizeSel = (f: HumanizeForm) => sel.length && o.onChange(humanize(notes, sel, { time: f.time / 100, vel: f.vel / 100 }, len))
  const glueSel = () => sel.length > 1 && o.onChange(glue(notes, sel))
  const legatoSel = () => sel.length && o.onChange(legato(notes, sel))
  const transpose = (semis: number) => sel.length && o.onChange(shift(notes, sel, 0, semis, len))
  const copy = (cut: boolean) => {
    clipboard = copyNotes(notes, sel) ?? clipboard
    if (cut) remove(sel)
  }
  /** 貼り付け: 選んでいる音符の終わりの次（選んでいなければ見えている左端）へ */
  const paste = () => {
    if (!clipboard) return
    const at = sel.length ? selectionEnd(notes, sel) : Math.round(o.left / step) * step
    const r = pasteNotes(notes, clipboard, at, len)
    o.onChange(r.notes)
    o.setSelected(r.added)
  }
  const duplicate = () => {
    copy(false)
    paste()
  }
  const onKey = (e: KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey
    const key = e.key.toLowerCase()
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel.length) remove(sel)
    else if (mod && key === 'a') o.setSelected(notes.map((n) => n.id))
    else if (mod && (key === 'c' || key === 'x')) copy(key === 'x')
    else if (mod && key === 'v') paste()
    else if (mod && key === 'd') duplicate()
    else if (mod && key === 'g') glueSel()
    else if (!mod && key === 'q') quantizeSel()
    else if (!mod && TOOL_KEYS[key]) o.setTool(TOOL_KEYS[key])
    else if (!mod && sel.length && e.key.startsWith('Arrow')) {
      const dir = e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 1
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') o.onChange(e.shiftKey ? resize(notes, sel, dir * step, len) : shift(notes, sel, dir * step, 0, len))
      else transpose(dir * (e.shiftKey ? 12 : 1))
    } else return
    e.preventDefault()
  }
  return { remove, quantizeSel, humanizeSel, glueSel, legatoSel, transpose, copy, paste, duplicate, onKey }
}
