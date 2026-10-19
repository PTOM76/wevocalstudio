// ピッチをつなぐ長さと、エンベロープの形状を選ぶダイアログ
import { Button, DialogActions, DialogContent, Stack, TextField, Typography } from '@mui/material'
import { WindowDialog, enterToSubmit } from 'pevenmui'
import { LabeledSelect as Choice } from 'wevocal-lib/react'
import { useState } from 'react'
import { useT } from './i18n'
import { GLIDE_SECONDS, type GlideShape } from './glide'

export default function GlideDialog(p: { open: boolean; onClose: () => void; onApply: (options: { seconds: number; shape: GlideShape }) => void }) {
  const t = useT()
  const [duration, setDuration] = useState(String(GLIDE_SECONDS * 1000))
  const [shape, setShape] = useState<GlideShape>('linear')
  const milliseconds = Number(duration)
  const valid = Number.isFinite(milliseconds) && milliseconds > 0
  const run = () => {
    if (!valid) return
    p.onApply({ seconds: milliseconds / 1000, shape })
    p.onClose()
  }
  return (
    <WindowDialog open={p.open} onClose={p.onClose} title={t('glide.title')} name="glidePitch" width={420} height={300} onKeyDown={enterToSubmit(run)} dialogProps={{ maxWidth: 'xs', fullWidth: true }}>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            label={t('glide.duration')}
            type="number"
            size="small"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            slotProps={{ htmlInput: { min: 1, step: 1 } }}
          />
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t('glide.durationHelp')}</Typography>
          <Choice
            label={t('glide.shape')}
            value={shape}
            options={[
              ['linear', t('glide.shapeLinear')],
              ['smooth', t('glide.shapeSmooth')],
              ['easeIn', t('glide.shapeEaseIn')],
              ['easeOut', t('glide.shapeEaseOut')],
            ]}
            onChange={(value) => {
              if (value === 'linear' || value === 'smooth' || value === 'easeIn' || value === 'easeOut') setShape(value)
            }}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={p.onClose}>{t('common.cancel')}</Button>
        <Button disabled={!valid} onClick={run}>{t('glide.apply')}</Button>
      </DialogActions>
    </WindowDialog>
  )
}
