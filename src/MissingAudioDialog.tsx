// ほかの DAW から読み込んだとき見つからなかった音声（Source の missing）に、ファイルを選んで割り当てる。割り当てるまでは無音の仮の音
import { Box, Button, DialogActions, DialogContent, Typography } from '@mui/material'
import { useRef, useState } from 'react'
import { WindowDialog, pevenFont } from 'pevenmui'
import { AUDIO_ACCEPT, decodeFile, type Clip } from 'wevocal-lib'
import { useT } from './i18n'
import type { Project } from './project'

export default function MissingAudioDialog(p: { open: boolean; project: Project; onAssign: (source: string, clip: Clip, name: string) => void; onError: (e: unknown) => void; onClose: () => void }) {
  const t = useT()
  const input = useRef<HTMLInputElement>(null)
  const [target, setTarget] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const missing = p.project.sources.filter((s) => s.missing)
  const pick = (id: string) => {
    setTarget(id)
    input.current?.click()
  }
  const onFile = async (file: File | undefined) => {
    if (!file || !target) return
    setBusy(target)
    try {
      p.onAssign(target, await decodeFile(file), file.name)
    } catch (e) {
      p.onError(e)
    } finally {
      setBusy(null)
    }
  }
  return (
    <WindowDialog open={p.open} onClose={p.onClose} title={t('missingAudio.title')} name="missingAudio" width={520} height={420} dialogProps={{ fullWidth: true, maxWidth: 'sm' }}>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Typography sx={{ fontSize: pevenFont('sm'), color: 'text.secondary' }}>{t('missingAudio.help')}</Typography>
          {!missing.length && <Typography sx={{ fontSize: pevenFont('base') }}>{t('missingAudio.none')}</Typography>}
          {missing.map((s) => (
            <Box key={s.id} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography sx={{ flex: 1, minWidth: 0, fontSize: pevenFont('base'), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.missing}>
                {s.missing}
              </Typography>
              <Button size="small" disabled={busy !== null} onClick={() => pick(s.id)}>
                {busy === s.id ? t('missingAudio.loading') : t('missingAudio.pick')}
              </Button>
            </Box>
          ))}
        </Box>
        <input
          ref={input}
          type="file"
          accept={AUDIO_ACCEPT}
          hidden
          onChange={(e) => {
            void onFile(e.target.files?.[0])
            e.target.value = ''
          }}
        />
      </DialogContent>
      <DialogActions>
        <Button size="small" onClick={p.onClose}>
          {t('common.close')}
        </Button>
      </DialogActions>
    </WindowDialog>
  )
}
