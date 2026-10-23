// ピアノロールのダイアログ（中身は pianoRoll/PianoRoll.tsx）。MIDI ブロックの音符を編集する
import { DialogContent } from '@mui/material'
import { WindowDialog, useDock, useMobileLayout } from 'pevenmui'
import { useT } from './i18n'
import PianoRoll, { type PianoRollProps } from './pianoRoll/PianoRoll'

/** メニューバーの行の右端に並ぶ、元に戻す、やり直しのボタンの幅（px）。別の窓の「欄に置く」ボタンをその分ずらす */
const ROLL_UNDO_WIDTH = 64

export default function PianoRollDialog(p: PianoRollProps & { open: boolean; onClose: () => void }) {
  const t = useT()
  const { open, onClose, ...roll } = p
  const mobile = useMobileLayout()
  const dock = useDock()
  const docked = !!dock?.isDocked('pianoRoll') && !mobile
  return (
    <WindowDialog open={open} onClose={onClose} title={t('roll.title')} name="pianoRoll" dockable={!mobile} dockInset={ROLL_UNDO_WIDTH} closeLabel={t('common.close')} width={960} height={720} dialogProps={{ fullWidth: true, maxWidth: 'lg', fullScreen: mobile }}>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', p: 0, overflow: 'hidden' }}>
        <PianoRoll {...roll} toolbar={!docked || !!dock?.toolHost} chromeHost={docked ? dock?.toolHost : undefined} />
      </DialogContent>
    </WindowDialog>
  )
}
