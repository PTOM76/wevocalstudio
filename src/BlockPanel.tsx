// 選んだ波形ブロックの値（音量、ピッチ、処理方式、フェード、ミュート）を変える欄
import { Box, Checkbox, FormControlLabel, MenuItem, TextField, Typography } from '@mui/material'
import { ALGORITHM_NAMES, type Algorithm } from 'wevocal-lib'
import { useT } from './i18n'
import type { Block } from './project'

const FIELDS = [
  ['gain', 'block.gain', 0.5],
  ['pitch', 'block.pitch', 0.1],
  ['fadeIn', 'block.fadeIn', 0.05],
  ['fadeOut', 'block.fadeOut', 0.05],
] as const

export default function BlockPanel(p: { block: Block; name: string; onChange: (patch: Partial<Block>) => void }) {
  const t = useT()
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 1.5, py: 1, borderTop: 1, borderColor: 'divider', flexWrap: 'wrap' }}>
      <Typography variant="body2" noWrap sx={{ maxWidth: 200 }} title={p.name}>
        {p.name}
      </Typography>
      {FIELDS.map(([key, label, step]) => (
        <TextField
          key={key}
          size="small"
          type="number"
          label={t(label)}
          value={p.block[key]}
          slotProps={{ htmlInput: { step } }}
          onChange={(e) => {
            const v = Number(e.target.value)
            if (!Number.isFinite(v)) return
            // フェードは 0 から長さの半分まで
            p.onChange({ [key]: key.startsWith('fade') ? Math.max(0, Math.min(v, p.block.length / 2)) : v })
          }}
          sx={{ width: 110 }}
        />
      ))}
      <TextField select size="small" label={t('block.algorithm')} value={p.block.algorithm} onChange={(e) => p.onChange({ algorithm: e.target.value as Algorithm })} sx={{ width: 150 }}>
        {(Object.entries(ALGORITHM_NAMES) as [Algorithm, string][]).map(([id, name]) => (
          <MenuItem key={id} value={id}>
            {name}
          </MenuItem>
        ))}
      </TextField>
      <FormControlLabel control={<Checkbox size="small" checked={p.block.preserveFormant} onChange={(e) => p.onChange({ preserveFormant: e.target.checked })} />} label={t('block.preserveFormant')} />
      <FormControlLabel control={<Checkbox size="small" checked={p.block.mute} onChange={(e) => p.onChange({ mute: e.target.checked })} />} label={t('block.mute')} />
    </Box>
  )
}
