// マーカーの名前の変更と削除（目盛りの上のマーカーをダブルクリック）
import { useEffect, useState } from 'react'
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField } from '@mui/material'
import { enterToSubmit } from 'pevenmui'
import { useT } from './i18n'
import type { Marker } from './project'

export default function MarkerDialog(p: { marker: Marker | null; onClose: () => void; onRename: (name: string) => void; onRemove: () => void }) {
  const t = useT()
  const [name, setName] = useState('')
  useEffect(() => setName(p.marker?.name ?? ''), [p.marker])
  const ok = () => {
    if (name.trim()) p.onRename(name.trim())
    p.onClose()
  }
  return (
    <Dialog open={!!p.marker} onClose={p.onClose} maxWidth="xs" fullWidth onKeyDown={enterToSubmit(ok)}>
      <DialogTitle>{t('marker.title')}</DialogTitle>
      <DialogContent>
        <TextField autoFocus fullWidth size="small" label={t('marker.name')} value={name} onChange={(e) => setName(e.target.value)} sx={{ mt: 1 }} />
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
