// 最適化して保存のダイアログ（何を確定し、何を捨てるかを選ぶ。実行は useProjectFile の saveOptimized）
import { useState } from 'react'
import { Box, Button, Checkbox, DialogActions, DialogContent, FormControlLabel, Radio, RadioGroup, Stack, Typography } from '@mui/material'
import { WindowDialog, enterToSubmit } from 'pevenmui'
import { useT, type MessageKey } from './i18n'
import type { OptimizeOptions } from './optimize'

export default function OptimizeDialog(p: { open: boolean; selected: string[]; onClose: () => void; onRun: (o: OptimizeOptions) => void }) {
  const t = useT()
  const [bake, setBake] = useState<OptimizeOptions['bake']>('none')
  const [onlySelected, setOnlySelected] = useState(false)
  const [trim, setTrim] = useState(true)
  const [dropUnused, setDropUnused] = useState(true)
  const run = () => {
    p.onRun({ bake, scope: onlySelected && p.selected.length ? p.selected : null, trim, dropUnused })
    p.onClose()
  }
  const heading = (key: MessageKey) => (
    <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>
      {t(key)}
    </Typography>
  )
  const option = (value: string, label: MessageKey) => <FormControlLabel value={value} control={<Radio size="small" />} label={t(label)} />
  return (
    <WindowDialog open={p.open} onClose={p.onClose} title={t('optimize.title')} name="optimize" width={480} height={520} onKeyDown={enterToSubmit(run)} dialogProps={{ maxWidth: 'xs', fullWidth: true }}>
      <DialogContent>
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>
          {t('optimize.help')}
        </Typography>
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          <Stack spacing={0.5}>
            {heading('optimize.bake')}
            <RadioGroup value={bake} onChange={(e) => setBake(e.target.value as OptimizeOptions['bake'])}>
              {option('none', 'optimize.bakeNone')}
              {option('pitch', 'optimize.bakePitch')}
              {option('all', 'optimize.bakeAll')}
            </RadioGroup>
            {/* 選んでいる波形ブロックがあるときだけ、確定する範囲を選べる */}
            {bake !== 'none' && p.selected.length > 0 && (
              <FormControlLabel control={<Checkbox size="small" checked={onlySelected} onChange={(e) => setOnlySelected(e.target.checked)} />} label={t('optimize.onlySelected')} />
            )}
            {bake !== 'none' && (
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {t('optimize.bakeHelp')}
              </Typography>
            )}
          </Stack>
          <Stack spacing={0.5}>
            {heading('optimize.discard')}
            <FormControlLabel control={<Checkbox size="small" checked={trim} onChange={(e) => setTrim(e.target.checked)} />} label={t('optimize.trim')} />
            <FormControlLabel control={<Checkbox size="small" checked={dropUnused} onChange={(e) => setDropUnused(e.target.checked)} />} label={t('optimize.dropUnused')} />
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Box sx={{ flex: 1 }} />
        <Button onClick={p.onClose}>{t('common.cancel')}</Button>
        <Button onClick={run}>{t('optimize.run')}</Button>
      </DialogActions>
    </WindowDialog>
  )
}
