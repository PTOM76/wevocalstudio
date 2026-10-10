// マーカーの名前の変更と削除、ここからテンポを変える（目盛りの上のマーカーをダブルクリック。テンポは WeVocalSynth と同じ）
import { useEffect, useState } from 'react'
import { Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Stack, TextField } from '@mui/material'
import { enterToSubmit } from 'pevenmui'
import { useT } from './i18n'
import type { Marker } from './project'

export default function MarkerDialog(p: { marker: Marker | null; bpm: number; beatsPerBar: number; onClose: () => void; onChange: (patch: Partial<Marker>) => void; onRemove: () => void }) {
  const t = useT()
  const [name, setName] = useState('')
  // ここからテンポを変えるか、その BPM と拍子
  const [tempoOn, setTempoOn] = useState(false)
  const [bpm, setBpm] = useState('')
  const [beats, setBeats] = useState('')
  useEffect(() => {
    setName(p.marker?.name ?? '')
    setTempoOn(!!p.marker?.tempo)
    setBpm(String(p.marker?.tempo?.bpm ?? p.bpm))
    setBeats(String(p.marker?.tempo?.beatsPerBar ?? p.beatsPerBar))
    // マーカーを開いたときだけ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.marker])
  const ok = () => {
    const b = Number(bpm)
    const n = Math.round(Number(beats))
    const tempo = tempoOn && b >= 20 && b <= 400 && n >= 1 && n <= 16 ? { bpm: b, beatsPerBar: n } : undefined
    p.onChange({ name: name.trim() || p.marker!.name, tempo })
    p.onClose()
  }
  return (
    <Dialog open={!!p.marker} onClose={p.onClose} maxWidth="xs" fullWidth onKeyDown={enterToSubmit(ok)}>
      <DialogTitle>{t('marker.title')}</DialogTitle>
      <DialogContent>
        <TextField autoFocus fullWidth size="small" label={t('marker.name')} value={name} onChange={(e) => setName(e.target.value)} sx={{ mt: 1 }} />
        <FormControlLabel sx={{ mt: 1 }} control={<Checkbox checked={tempoOn} onChange={(e) => setTempoOn(e.target.checked)} />} label={t('marker.tempo')} />
        {tempoOn && (
          <Stack direction="row" spacing={2} sx={{ mt: 1 }}>
            <TextField size="small" type="number" label="BPM" value={bpm} onChange={(e) => setBpm(e.target.value)} slotProps={{ htmlInput: { min: 20, max: 400, step: 0.1 } }} sx={{ width: 120 }} />
            <TextField size="small" type="number" label={t('transport.beatsPerBar')} value={beats} onChange={(e) => setBeats(e.target.value)} slotProps={{ htmlInput: { min: 1, max: 16, step: 1 } }} sx={{ width: 120 }} />
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button
          color="error"
          onClick={() => {
            p.onRemove()
            p.onClose()
          }}
        >
          {t('marker.remove')}
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button onClick={p.onClose}>{t('common.cancel')}</Button>
        <Button onClick={ok}>{t('common.ok')}</Button>
      </DialogActions>
    </Dialog>
  )
}
