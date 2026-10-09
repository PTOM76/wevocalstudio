// 書き出しのダイアログ（形式、WAV のサンプル形式、ビットレート）。全トラックをマスターまで混ぜて書き出す
import { useState } from 'react'
import { Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, MenuItem, Stack, TextField } from '@mui/material'
import type { ExportFormat, WavFormat } from 'wevocal-lib'
import { useT } from './i18n'

export interface ExportChoice {
  format: ExportFormat
  wavFormat: WavFormat
  kbps: number
  /** 範囲選択の所だけを書き出す */
  rangeOnly: boolean
}

const FORMATS: [ExportFormat, string][] = [
  ['wav', 'WAV'],
  ['flac', 'FLAC'],
  ['mp3', 'MP3'],
  ['aac', 'AAC (M4A)'],
  ['opus', 'Opus (OGG)'],
]
const WAV_FORMATS: [WavFormat, string][] = [
  ['pcm16', '16 bit'],
  ['pcm24', '24 bit'],
  ['float32', '32 bit float'],
]
const KBPS = [96, 128, 192, 256, 320]

export default function ExportDialog(p: { hasRange: boolean; open: boolean; onClose: () => void; onExport: (c: ExportChoice) => void }) {
  const t = useT()
  const [c, setC] = useState<ExportChoice>({ format: 'wav', wavFormat: 'pcm24', kbps: 192, rangeOnly: true })
  const lossless = c.format === 'wav' || c.format === 'flac'
  return (
    <Dialog open={p.open} onClose={p.onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{t('export.title')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField select size="small" label={t('export.format')} value={c.format} onChange={(e) => {
              const format = e.target.value as ExportFormat
              setC({ ...c, format, wavFormat: format === 'flac' && c.wavFormat === 'float32' ? 'pcm24' : c.wavFormat })
            }}>
            {FORMATS.map(([v, l]) => (
              <MenuItem key={v} value={v}>
                {l}
              </MenuItem>
            ))}
          </TextField>
          {lossless ? (
            <TextField select size="small" label={t('export.bits')} value={c.wavFormat} onChange={(e) => setC({ ...c, wavFormat: e.target.value as WavFormat })}>
              {/* FLAC は 32bit float を 24bit にする（wevocal-lib） */}
              {WAV_FORMATS.filter(([v]) => c.format === 'wav' || v !== 'float32').map(([v, l]) => (
                <MenuItem key={v} value={v}>
                  {l}
                </MenuItem>
              ))}
            </TextField>
          ) : (
            <TextField select size="small" label={t('export.bitrate')} value={c.kbps} onChange={(e) => setC({ ...c, kbps: Number(e.target.value) })}>
              {KBPS.map((v) => (
                <MenuItem key={v} value={v}>
                  {v} kbps
                </MenuItem>
              ))}
            </TextField>
          )}
          {p.hasRange && (
            <FormControlLabel control={<Checkbox checked={c.rangeOnly} onChange={(e) => setC({ ...c, rangeOnly: e.target.checked })} />} label={t('export.rangeOnly')} />
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={p.onClose}>{t('common.cancel')}</Button>
        <Button
          onClick={() => {
            p.onExport({ ...c, rangeOnly: p.hasRange && c.rangeOnly })
            p.onClose()
          }}
        >
          {t('export.run')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
