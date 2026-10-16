// MIDI ブロックのプロパティ（位置、長さ、ミュート）。音符はピアノロールで編集する
import { Box, Button, DialogActions, DialogContent, FormControlLabel, Switch, Typography } from '@mui/material'
import { NumberInput, WindowDialog, pevenFont } from 'pevenmui'
import { useT } from './i18n'
import type { MidiBlock } from './project'

export default function MidiBlockDialog(p: { open: boolean; block: MidiBlock | null; onChange: (patch: Partial<MidiBlock>, merge?: string) => void; onPianoRoll: () => void; onClose: () => void }) {
  const t = useT()
  const b = p.block
  const row = (label: string, value: number, key: 'start' | 'length', min: number) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
      <Typography sx={{ fontSize: pevenFont('base'), width: 90 }}>{label}</Typography>
      <NumberInput value={Math.round(value * 1000) / 1000} onChange={(v) => p.onChange({ [key]: v }, `midiprops:${key}`)} min={min} max={36000} step={0.01} unit="s" width={110} ariaLabel={label} />
    </Box>
  )
  return (
    <WindowDialog open={p.open} onClose={p.onClose} title={t('midiProps.title')} name="midiProps" width={380} height={300} dialogProps={{ fullWidth: true, maxWidth: 'xs' }}>
      <DialogContent>
        {b && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            {row(t('clip.start'), b.start, 'start', 0)}
            {row(t('midiProps.length'), b.length, 'length', 0.05)}
            <Typography sx={{ fontSize: pevenFont('sm'), color: 'text.secondary' }}>{t('midiProps.notes', { n: b.notes.length })}</Typography>
            <FormControlLabel control={<Switch size="small" checked={b.mute} onChange={(e) => p.onChange({ mute: e.target.checked })} />} label={<Typography sx={{ fontSize: pevenFont('base') }}>{t('midiProps.mute')}</Typography>} />
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button size="small" onClick={p.onPianoRoll} sx={{ mr: 'auto' }}>
          {t('menu.editMidi')}
        </Button>
        <Button size="small" onClick={p.onClose}>
          {t('common.close')}
        </Button>
      </DialogActions>
    </WindowDialog>
  )
}
