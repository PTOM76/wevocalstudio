// ピッチをつなぐ長さと、エンベロープの形状を選ぶダイアログ
import { Button, DialogActions, DialogContent, Slider, Stack, TextField, Typography } from '@mui/material'
import { WindowDialog, enterToSubmit } from 'pevenmui'
import { LabeledSelect as Choice } from 'wevocal-lib/react'
import { useState } from 'react'
import { useT } from './i18n'
import { GLIDE_SECONDS, type GlideShape } from './glide'

export default function GlideDialog(p: { open: boolean; onClose: () => void; onApply: (options: { seconds: number; shape: GlideShape; tension: number }) => void }) {
  const t = useT()
  const [duration, setDuration] = useState(String(GLIDE_SECONDS * 1000))
  const [shape, setShape] = useState<GlideShape>('linear')
  const [tension, setTension] = useState(0)
  const milliseconds = Number(duration)
  const valid = Number.isFinite(milliseconds) && milliseconds > 0
  const run = () => {
    if (!valid) return
    p.onApply({ seconds: milliseconds / 1000, shape, tension })
    p.onClose()
  }
  return (
    <WindowDialog open={p.open} onClose={p.onClose} title={t('glide.title')} name="glidePitch" width={420} height={shape === 'bezier' ? 380 : 300} onKeyDown={enterToSubmit(run)} dialogProps={{ maxWidth: 'xs', fullWidth: true }}>
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
              ['square', t('glide.shapeSquare')],
              ['slowStartEnd', t('glide.shapeSlowStartEnd')],
              ['fastStart', t('glide.shapeFastStart')],
              ['fastEnd', t('glide.shapeFastEnd')],
              ['bezier', t('glide.shapeBezier')],
            ]}
            onChange={(value) => {
              if (value === 'linear' || value === 'square' || value === 'slowStartEnd' || value === 'fastStart' || value === 'fastEnd' || value === 'bezier') setShape(value)
            }}
          />
          {shape === 'bezier' && (
            <Stack spacing={0.5}>
              <Typography variant="body2">{t('glide.tension', { n: tension.toFixed(2) })}</Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t('glide.tensionHelp')}</Typography>
              <Slider
                value={tension}
                min={-1}
                max={1}
                step={0.05}
                valueLabelDisplay="auto"
                onChange={(_, value) => typeof value === 'number' && setTension(value)}
              />
            </Stack>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={p.onClose}>{t('common.cancel')}</Button>
        <Button disabled={!valid} onClick={run}>{t('glide.apply')}</Button>
      </DialogActions>
    </WindowDialog>
  )
}
