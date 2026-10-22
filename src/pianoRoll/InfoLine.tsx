// ピアノロールの情報行: 選んだ音符の値（複数のときは先頭の値）を数値で見て直す。入れた値は選んだ全部に反映する。右端には、下のレーンの選択
import { Box, Button, Typography } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCaretDown } from '@fortawesome/free-solid-svg-icons'
import { ContextMenu, NumberInput, pevenFont } from 'pevenmui'
import { useState } from 'react'
import { useT } from '../i18n'
import type { Note } from '../project'
import { setDuration, shift, velocity } from './edit'
import { LANES, type Lane } from './laneEdit'
import { NAMES } from './view'

export default function InfoLine(p: {
  notes: Note[]
  selected: string[]
  /** ブロックの長さ（拍）と、グリッドの間隔（拍） */
  len: number
  step: number
  onChange: (notes: Note[], merge?: string) => void
  lane: Lane
  laneLabel: (lane: Lane) => string
  onLane: (lane: Lane) => void
}) {
  const t = useT()
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const { notes, selected: sel, len, step } = p
  const lead = notes.find((n) => sel.includes(n.id))
  const field = (label: string, value: number, min: number, max: number, stepBy: number, unit: string, apply: (v: number) => Note[]) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      <Typography sx={{ fontSize: pevenFont('sm'), color: 'text.secondary' }}>{label}</Typography>
      <NumberInput value={Math.round(value * 1000) / 1000} onChange={(v) => p.onChange(apply(v), `info:${label}`)} min={min} max={max} step={stepBy} unit={unit} width={96} disabled={!lead} ariaLabel={label} />
    </Box>
  )
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', px: 1.5, py: 0.75, borderBottom: 1, borderColor: 'divider' }}>
      {field(t('roll.start'), lead?.t ?? 0, 0, len, step, t('roll.beatUnit'), (v) => shift(notes, sel, v - (lead?.t ?? 0), 0, len))}
      {field(t('roll.length'), lead?.dur ?? 0, 1 / 64, len, step, t('roll.beatUnit'), (v) => setDuration(notes, sel, v, len))}
      {field(t('roll.pitch'), lead?.pitch ?? 60, 0, 127, 1, '', (v) => shift(notes, sel, 0, v - (lead?.pitch ?? 60), len))}
      {field(t('roll.velocity'), Math.round((lead?.vel ?? 0.8) * 127), 1, 127, 1, '', (v) => velocity(notes, sel, 'set', v / 127))}
      {lead && <Typography sx={{ fontSize: pevenFont('sm'), color: 'text.secondary' }}>{`${NAMES[lead.pitch % 12]}${Math.floor(lead.pitch / 12) - 1}`}</Typography>}
      <Box sx={{ flex: 1 }} />
      <Button size="small" color="inherit" endIcon={<FontAwesomeIcon icon={faCaretDown} />} onClick={(e) => setMenu({ x: e.currentTarget.getBoundingClientRect().left, y: e.currentTarget.getBoundingClientRect().bottom })}>
        {t('roll.lane', { name: p.laneLabel(p.lane) })}
      </Button>
      <ContextMenu position={menu} entries={LANES.map((l) => ({ label: p.laneLabel(l), checked: p.lane === l, onClick: () => p.onLane(l) }))} onClose={() => setMenu(null)} />
    </Box>
  )
}
