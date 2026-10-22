// ピアノロールのダイアログ（中身は pianoRoll/PianoRoll.tsx）。MIDI ブロックの音符を編集する
import { Button, DialogActions, DialogContent } from '@mui/material'
import { WindowDialog } from 'pevenmui'
import { useT } from './i18n'
import PianoRoll, { type PianoRollProps } from './pianoRoll/PianoRoll'

export default function PianoRollDialog(p: PianoRollProps & { open: boolean; onClose: () => void }) {
  const t = useT()
  const { open, onClose, ...roll } = p
  return (
    <WindowDialog open={open} onClose={onClose} title={t('roll.title')} name="pianoRoll" width={960} height={720} dialogProps={{ fullWidth: true, maxWidth: 'lg' }}>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column' }}>
        <PianoRoll {...roll} />
      </DialogContent>
      <DialogActions>
        <Button size="small" onClick={onClose}>
          {t('common.close')}
        </Button>
      </DialogActions>
    </WindowDialog>
  )
}
