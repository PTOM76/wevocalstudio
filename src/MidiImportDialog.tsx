// MIDI ファイルの読み込みの選択（トラック、チャンネルで分けるか、テンポをどうするか、置く位置）
import { useState } from 'react'
import { Box, Button, Checkbox, DialogActions, DialogContent, FormControlLabel, Switch, Typography } from '@mui/material'
import { WindowDialog, pevenFont } from 'pevenmui'
import { LabeledSelect as Choice } from 'wevocal-lib/react'
import { useT } from './i18n'
import type { MidiImportOptions, MidiPending } from './midiImport'

export type MidiImportAt = 'cursor' | 'start'

export default function MidiImportDialog(p: { pending: MidiPending; onImport: (o: MidiImportOptions, at: MidiImportAt) => void; onClose: () => void }) {
  const t = useT()
  const { midi } = p.pending
  const [tracks, setTracks] = useState<number[]>(() => midi.tracks.map((_, i) => i))
  const [splitChannels, setSplit] = useState(false)
  const [tempo, setTempo] = useState<MidiImportOptions['tempo']>('project')
  const [at, setAt] = useState<MidiImportAt>('cursor')
  const toggle = (i: number) => setTracks((v) => (v.includes(i) ? v.filter((x) => x !== i) : [...v, i].sort((a, b) => a - b)))
  const small = { fontSize: pevenFont('base') }
  return (
    <WindowDialog open onClose={p.onClose} title={t('midiImport.title')} name="midiImport" width={460} height={520} dialogProps={{ fullWidth: true, maxWidth: 'xs' }}>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Typography sx={{ fontSize: pevenFont('sm'), color: 'text.secondary' }}>{p.pending.name}</Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', maxHeight: 200, overflowY: 'auto' }}>
            {midi.tracks.map((mt, i) => (
              <FormControlLabel key={i} control={<Checkbox size="small" checked={tracks.includes(i)} onChange={() => toggle(i)} />} label={<Typography sx={small}>{t('midi.trackItem', { name: mt.name, count: mt.notes.length })}</Typography>} />
            ))}
          </Box>
          <FormControlLabel control={<Switch size="small" checked={splitChannels} onChange={(e) => setSplit(e.target.checked)} />} label={<Typography sx={small}>{t('midiImport.splitChannels')}</Typography>} />
          <Choice
            label={t('midiImport.tempo')}
            value={tempo}
            options={[
              ['project', t('midiImport.tempoProject')],
              ['midi', t('midi.tempoMidi', { bpm: midi.bpm })],
            ]}
            onChange={setTempo}
          />
          <Choice
            label={t('midi.offset')}
            value={at}
            options={[
              ['cursor', t('midiImport.atCursor')],
              ['start', t('midiImport.atStart')],
            ]}
            onChange={setAt}
          />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button size="small" onClick={p.onClose}>
          {t('common.cancel')}
        </Button>
        <Button size="small" disabled={!tracks.length} onClick={() => p.onImport({ tracks, splitChannels, tempo }, at)}>
          {t('midiImport.run')}
        </Button>
      </DialogActions>
    </WindowDialog>
  )
}
