// トラックのグラフィック EQ のダイアログ（WeVocalSynth と同じ EQ。グラフは wevocal-lib/react）
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Switch, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import { usePalette } from 'pevenmui'
import { eqRange, flatEq, isFlatEq, resizeEq, setEqRange, type EqBands, type EqRange, type TrackEq } from 'wevocal-lib'
import { EqGraph } from 'wevocal-lib/react'
import { useT } from './i18n'

export default function EqDialog(p: { open: boolean; trackName: string; eq: TrackEq; onChange: (eq: TrackEq) => void; onClose: () => void }) {
  const t = useT()
  const { pal } = usePalette()
  const { eq } = p
  return (
    <Dialog open={p.open} onClose={p.onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t('eq.title', { name: p.trackName })}</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', mb: 1 }}>
          <FormControlLabel control={<Switch checked={eq.on} onChange={(e) => p.onChange({ ...eq, on: e.target.checked })} />} label={t('eq.on')} />
          <ToggleButtonGroup size="small" exclusive value={eq.bands} onChange={(_, v: EqBands | null) => v && p.onChange(resizeEq(eq, v))}>
            <ToggleButton value={10}>{t('eq.bandsN', { n: 10 })}</ToggleButton>
            <ToggleButton value={31}>{t('eq.bandsN', { n: 31 })}</ToggleButton>
          </ToggleButtonGroup>
          <ToggleButtonGroup size="small" exclusive value={eqRange(eq)} onChange={(_, v: EqRange | null) => v && p.onChange(setEqRange(eq, v))}>
            {([12, 24] as const).map((r) => (
              <ToggleButton key={r} value={r}>
                ±{r} dB
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          <Button size="small" disabled={isFlatEq(eq) && eq.on} onClick={() => p.onChange({ ...flatEq(eq.bands), range: eq.range })}>
            {t('eq.flat')}
          </Button>
        </Box>
        <EqGraph
          eq={eq}
          onChange={(gains) => p.onChange({ ...eq, gains })}
          label={t('eq.graph')}
          colors={{ background: pal.action.hover, divider: pal.divider, text: pal.text.primary, textSecondary: pal.text.secondary, line: pal.primary.main, disabled: pal.text.disabled }}
        />
        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 1 }}>
          {t('eq.help')}
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={p.onClose}>{t('common.close')}</Button>
      </DialogActions>
    </Dialog>
  )
}
