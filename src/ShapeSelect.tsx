// 形状の選択（見本図つきの選択肢と、ベジェの張り具合のスライダー）。ピッチをつなぐダイアログとブロックのプロパティ（フェード）で共通
import { Slider, Stack, Typography } from '@mui/material'
import { LabeledSelect as Choice } from 'wevocal-lib/react'
import { useT } from './i18n'
import { ShapeIcon } from './ShapeIcon'
import type { EnvShape } from './envelopeCurve'
import { SHAPE_CHOICES, isEnvShape } from './shapeChoices'

export function ShapeSelect(p: { label: string; shape: EnvShape; tension: number; onChange: (shape: EnvShape, tension: number) => void }) {
  const t = useT()
  return (
    <>
      <Choice
        label={p.label}
        value={p.shape}
        options={SHAPE_CHOICES.map(([s, key]) => [
          s,
          <Stack key={s} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <ShapeIcon shape={s} tension={s === 'bezier' ? p.tension || 0.6 : undefined} />
            <span>{t(key)}</span>
          </Stack>,
        ])}
        onChange={(value) => isEnvShape(value) && p.onChange(value, p.tension)}
      />
      {p.shape === 'bezier' && (
        <Stack spacing={0.5}>
          <Typography variant="body2">{t('glide.tension', { n: p.tension.toFixed(2) })}</Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t('glide.tensionHelp')}</Typography>
          <Slider value={p.tension} min={-1} max={1} step={0.05} valueLabelDisplay="auto" onChange={(_, v) => typeof v === 'number' && p.onChange(p.shape, v)} />
        </Stack>
      )}
    </>
  )
}
