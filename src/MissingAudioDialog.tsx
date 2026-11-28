// ほかの DAW から読み込んだとき見つからなかった音声（Source の missing）に、ファイルを選んで割り当てる。フォルダーを選ぶと、中からパスと名前でまとめて探す。割り当てるまでは無音の仮の音
import { Box, Button, DialogActions, DialogContent, LinearProgress, Typography } from '@mui/material'
import { useRef, useState } from 'react'
import { WindowDialog, pevenFont } from 'pevenmui'
import { pickFolderFiles } from 'pevenmui/web'
import { AUDIO_ACCEPT, decodeFile, type Clip } from 'wevocal-lib'
import { matchAudio } from './exchange/fromExchange'
import { useT } from './i18n'
import type { Project } from './project'

/** 音声として探すファイル（拡張子で見る） */
const AUDIO_EXT = new Set(AUDIO_ACCEPT.split(',').map((s) => s.trim().toLowerCase()).filter((s) => s.startsWith('.')))
const isAudioName = (name: string) => AUDIO_EXT.has(name.toLowerCase().match(/\.[^.]+$/)?.[0] ?? '')

export type AudioAssignment = { source: string; clip: Clip; name: string }

export default function MissingAudioDialog(p: { open: boolean; project: Project; onAssign: (list: AudioAssignment[]) => void; onError: (e: unknown) => void; onNotify: (message: string) => void; onClose: () => void }) {
  const t = useT()
  const input = useRef<HTMLInputElement>(null)
  const [target, setTarget] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  /** フォルダーから探している間の進み具合（探している間は total が 0、読み込み中は読み込んだ数と見つかった数と名前） */
  const [progress, setProgress] = useState<{ done: number; total: number; name: string } | null>(null)
  const missing = p.project.sources.filter((s) => s.missing)
  const pick = (id: string) => {
    setTarget(id)
    input.current?.click()
  }
  const onFile = async (file: File | undefined) => {
    if (!file || !target) return
    setBusy(target)
    try {
      p.onAssign([{ source: target, clip: await decodeFile(file), name: file.name }])
    } catch (e) {
      p.onError(e)
    } finally {
      setBusy(null)
    }
  }
  /** フォルダーを選び、見つからない音声をまとめて探す（.rpp のあるフォルダーを選ぶ想定。サブフォルダーも見る） */
  const fromFolder = async (win: Window) => {
    setBusy('folder')
    setProgress({ done: 0, total: 0, name: '' })
    try {
      // 押した窓で開く（ダイアログを別の窓に出しているとき、元の窓ではクリックとみなされず開けない）
      const files = await pickFolderFiles(isAudioName, win)
      if (!files) return
      const found = matchAudio(
        missing.map((s) => s.missing!),
        files,
      )
      const list: AudioAssignment[] = []
      const hits = missing.filter((s) => found.has(s.missing!))
      for (const s of hits) {
        const file = found.get(s.missing!)!
        setProgress({ done: list.length, total: hits.length, name: file.name })
        list.push({ source: s.id, clip: await decodeFile(file), name: file.name })
      }
      setProgress({ done: list.length, total: hits.length, name: '' })
      // 進み具合を描いてから割り当てる（割り当ては波形の計算などで少し止まる）
      await new Promise((r) => setTimeout(r, 30))
      if (list.length) p.onAssign(list)
      p.onNotify(t('missingAudio.found', { n: list.length, total: missing.length }))
    } catch (e) {
      p.onError(e)
    } finally {
      setBusy(null)
      setProgress(null)
    }
  }
  return (
    <WindowDialog open={p.open} onClose={p.onClose} title={t('missingAudio.title')} name="missingAudio" width={520} height={420} dialogProps={{ fullWidth: true, maxWidth: 'sm' }}>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Typography sx={{ fontSize: pevenFont('sm'), color: 'text.secondary' }}>{t('missingAudio.help')}</Typography>
          {!missing.length && <Typography sx={{ fontSize: pevenFont('base') }}>{t('missingAudio.none')}</Typography>}
          {missing.length > 0 && (
            <Box>
              <Button size="small" disabled={busy !== null} onClick={(e) => void fromFolder(e.currentTarget.ownerDocument.defaultView ?? window)}>
                {busy === 'folder' ? t('missingAudio.loading') : t('missingAudio.folder')}
              </Button>
            </Box>
          )}
          {progress && (
            <Box>
              <LinearProgress variant={progress.total ? 'determinate' : 'indeterminate'} value={progress.total ? (progress.done / progress.total) * 100 : 0} />
              <Typography sx={{ fontSize: pevenFont('sm'), color: 'text.secondary', mt: 0.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {progress.total ? t('missingAudio.progress', { done: progress.done, total: progress.total, name: progress.name }) : t('missingAudio.searching')}
              </Typography>
            </Box>
          )}
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
