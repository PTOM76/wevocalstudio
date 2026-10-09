// 操作履歴の一覧（WeVocalSynth と同じ）。押した所まで戻る、または進む
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, List, ListItemButton, ListItemText } from '@mui/material'
import { useT, type MessageKey } from './i18n'

export default function HistoryDialog(p: { open: boolean; steps: MessageKey[]; index: number; onGoto: (i: number) => void; onClose: () => void }) {
  const t = useT()
  return (
    <Dialog open={p.open} onClose={p.onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{t('history.title')}</DialogTitle>
      <DialogContent sx={{ px: 1 }}>
        <List dense>
          {p.steps.map((label, i) => (
            // 今より後（やり直せるもの）は薄く出す
            <ListItemButton key={i} selected={i === p.index} onClick={() => p.onGoto(i)} sx={{ opacity: i > p.index ? 0.5 : 1 }}>
              <ListItemText primary={`${i + 1}. ${t(label)}`} />
            </ListItemButton>
          ))}
        </List>
      </DialogContent>
      <DialogActions>
        <Button onClick={p.onClose}>{t('common.close')}</Button>
      </DialogActions>
    </Dialog>
  )
}
