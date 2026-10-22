// ピアノロールのダイアログ（中身は pianoRoll/PianoRoll.tsx）。MIDI ブロックの音符を編集する
import { Button, DialogActions, DialogContent } from '@mui/material'
import { WindowDialog, useDock, useMobileLayout } from 'pevenmui'
import { useT } from './i18n'
import PianoRoll, { type PianoRollProps } from './pianoRoll/PianoRoll'

export default function PianoRollDialog(p: PianoRollProps & { open: boolean; onClose: () => void }) {
  const t = useT()
  const { open, onClose, ...roll } = p
  const mobile = useMobileLayout()
  // 画面の下の欄に置いているときは、タブの × で閉じられるので、閉じるの行は出さない
  const dock = useDock()
  const docked = !!dock?.isDocked('pianoRoll') && !mobile
  return (
    <WindowDialog open={open} onClose={onClose} title={t('roll.title')} name="pianoRoll" dockable={!mobile} width={960} height={720} dialogProps={{ fullWidth: true, maxWidth: 'lg', fullScreen: mobile }}>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', p: 0, overflow: 'hidden' }}>
        <PianoRoll {...roll} toolbar={!docked || !!dock?.toolHost} chromeHost={docked ? dock?.toolHost : undefined} />
      </DialogContent>
      {!docked && (
      <DialogActions>
        <Button size="small" onClick={onClose}>
          {t('common.close')}
        </Button>
      </DialogActions>
      )}
    </WindowDialog>
  )
}
