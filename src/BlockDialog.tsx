// 波形ブロックのプロパティ（REAPER のアイテムのプロパティ）。位置、長さ、音量、ピッチ、処理方式、フェードを数値で指定する
import { useEffect, useState } from 'react'
import { Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, MenuItem, Stack, TextField, Typography } from '@mui/material'
import { enterToSubmit } from 'pevenmui'
import { ALGORITHM_NAMES, type Algorithm } from 'wevocal-lib'
import { useT, type MessageKey } from './i18n'
import { RATE_MAX, RATE_MIN, type Block } from './project'

/** 数値で指定する項目（名前、刻み、下限） */
const NUMBERS: [keyof Block & ('start' | 'length' | 'offset' | 'rate' | 'gain' | 'pitch' | 'formant' | 'fadeIn' | 'fadeOut'), MessageKey, number, number][] = [
  ['start', 'block.start', 0.001, 0],
  ['length', 'block.length', 0.001, 0.01],
  ['offset', 'block.offset', 0.001, 0],
  ['rate', 'block.rate', 0.01, RATE_MIN],
  ['gain', 'block.gain', 0.1, -60],
  ['pitch', 'block.pitch', 0.01, -24],
  ['formant', 'block.formant', 0.1, -12],
  ['fadeIn', 'block.fadeIn', 0.01, 0],
  ['fadeOut', 'block.fadeOut', 0.01, 0],
]

export default function BlockDialog(p: { block: Block | null; name: string; duration: number; onClose: () => void; onApply: (patch: Partial<Block>) => void }) {
  const t = useT()
  const [draft, setDraft] = useState<Block | null>(p.block)
  useEffect(() => setDraft(p.block), [p.block])
  if (!draft) return <Dialog open={false} />

  // 元の音を越えないように、長さと開始位置をそろえる
  const fit = (b: Block): Block => {
    const rate = Math.max(RATE_MIN, Math.min(RATE_MAX, b.rate))
    const offset = Math.min(Math.max(0, b.offset), p.duration - 0.01)
    // 時間軸の上の長さは、残りの元の音を速度で割ったものまで
    const length = Math.min(Math.max(0.01, b.length), (p.duration - offset) / rate)
    const pitch = Math.max(-24, Math.min(24, b.pitch))
    const formant = Math.max(-12, Math.min(12, b.formant))
    return { ...b, rate, offset, length, pitch, formant, fadeIn: Math.min(b.fadeIn, length), fadeOut: Math.min(b.fadeOut, length - Math.min(b.fadeIn, length)) }
  }
  const apply = () => {
    p.onApply(fit(draft))
    p.onClose()
  }

  return (
    <Dialog open={!!p.block} onClose={p.onClose} maxWidth="xs" fullWidth onKeyDown={enterToSubmit(apply)}>
      <DialogTitle>{t('block.properties')}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }} noWrap title={p.name}>
          {p.name}
        </Typography>
        <Stack spacing={2}>
          <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 2 }}>
            {NUMBERS.map(([key, label, step, min]) => (
              <TextField
                key={key}
                size="small"
                type="number"
                label={t(label)}
                value={draft[key]}
                slotProps={{ htmlInput: { step, min } }}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  if (!Number.isFinite(v)) return
                  const value = Math.max(min, v)
                  // 速度を変えたら、使う元の音の範囲はそのままで長さが変わる（REAPER と同じ）
                  if (key === 'rate' && value > 0) setDraft({ ...draft, rate: value, length: (draft.length * draft.rate) / value })
                  else setDraft({ ...draft, [key]: value })
                }}
                sx={{ width: 150 }}
              />
            ))}
          </Stack>
          <TextField select size="small" label={t('block.algorithm')} value={draft.algorithm} onChange={(e) => setDraft({ ...draft, algorithm: e.target.value as Algorithm })}>
            {(Object.entries(ALGORITHM_NAMES) as [Algorithm, string][]).map(([id, name]) => (
              <MenuItem key={id} value={id}>
                {name}
              </MenuItem>
            ))}
          </TextField>
          <Stack direction="row" sx={{ flexWrap: 'wrap' }}>
            <FormControlLabel control={<Checkbox checked={draft.preserveFormant} onChange={(e) => setDraft({ ...draft, preserveFormant: e.target.checked })} />} label={t('block.preserveFormant')} />
            <FormControlLabel control={<Checkbox checked={draft.mute} onChange={(e) => setDraft({ ...draft, mute: e.target.checked })} />} label={t('block.mute')} />
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={p.onClose}>{t('common.cancel')}</Button>
        <Button onClick={apply}>{t('common.ok')}</Button>
      </DialogActions>
    </Dialog>
  )
}
