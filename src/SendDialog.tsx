// トラックのセンド（このトラックの音を、ほかのトラックの入口へ送る。フェーダーのあとの音を、送る量だけ。リバーブなどを共有するバスに使う）
import { Box, Button, DialogActions, DialogContent, Typography } from '@mui/material'
import { SliderRow, WindowDialog, pevenFont } from 'pevenmui'
import { useT } from './i18n'
import { SEND_MIN, sendTargets, type Project, type Send } from './project'

export default function SendDialog(p: { open: boolean; project: Project; track: string; onChange: (sends: Send[]) => void; onClose: () => void }) {
  const t = useT()
  const track = p.project.tracks.find((x) => x.id === p.track)
  const sends = track?.sends ?? []
  const set = (to: string, db: number) => p.onChange(db <= SEND_MIN ? sends.filter((s) => s.to !== to) : sends.some((s) => s.to === to) ? sends.map((s) => (s.to === to ? { ...s, db } : s)) : [...sends, { to, db }])
  const targets = track ? sendTargets(p.project, track.id) : []
  return (
    <WindowDialog open={p.open} onClose={p.onClose} title={t('send.title', { name: track?.name ?? '' })} name="sends" width={480} height={420} dialogProps={{ fullWidth: true, maxWidth: 'xs' }}>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Typography sx={{ fontSize: pevenFont('sm'), color: 'text.secondary' }}>{t('send.help')}</Typography>
          {!targets.length && <Typography sx={{ fontSize: pevenFont('base') }}>{t('send.none')}</Typography>}
          {targets.map((x) => (
            <SliderRow
              key={x.id}
              label={x.name}
              value={sends.find((s) => s.to === x.id)?.db ?? SEND_MIN}
              min={SEND_MIN}
              max={6}
              step={0.5}
              unit="dB"
              defaultValue={SEND_MIN}
              onChange={(db) => set(x.id, db)}
            />
          ))}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button size="small" onClick={p.onClose}>
          {t('common.close')}
        </Button>
      </DialogActions>
    </WindowDialog>
  )
}
