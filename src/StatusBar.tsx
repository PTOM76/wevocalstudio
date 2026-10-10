// PC の下のステータスバー（WeVocalSynth と同じ並び）。プロジェクト名、書き出しの形式、範囲選択、BPM、処理中のゲージ
import { useState, type ReactNode } from 'react'
import { Box, Button, ButtonBase, Dialog, DialogActions, DialogContent, Popover, Stack, TextField } from '@mui/material'
import { JobGauge, StatusBar as Bar, StatusButton, StatusItem, StatusSpacer, enterToSubmit, pevenFont } from 'pevenmui'
import type { Range } from 'wevocal-lib'
import { useT } from './i18n'
import { formatTime } from './Transport'

/** 範囲選択の表示。押すと始まりと終わりを数字で入れられる（WeVocalSynth の SelectionField と同じ） */
function SelectionField(p: { range: Range | null; bpm: number; onChange: (r: Range | null) => void }) {
  const t = useT()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [draft, setDraft] = useState({ start: '', end: '' })
  const r = p.range
  const open = (el: HTMLElement) => {
    setDraft({ start: String(+(r?.start ?? 0).toFixed(3)), end: String(+(r?.end ?? 0).toFixed(3)) })
    setAnchor(el)
  }
  const apply = () => {
    const s = Number(draft.start)
    const e = Number(draft.end)
    if (Number.isFinite(s) && Number.isFinite(e) && e > s && s >= 0) p.onChange({ start: s, end: e })
    setAnchor(null)
  }
  const len = r ? r.end - r.start : 0
  return (
    <>
      <ButtonBase onClick={(e) => open(e.currentTarget)} sx={{ px: 1, height: '100%', fontSize: pevenFont('sm'), color: 'text.secondary', fontFamily: 'monospace' }}>
        {r ? `${formatTime(r.start)} – ${formatTime(r.end)}（${len.toFixed(3)} s / ${((len * p.bpm) / 60).toFixed(2)} ${t('status.beats')}）` : t('status.noRange')}
      </ButtonBase>
      <Popover open={!!anchor} anchorEl={anchor} onClose={() => setAnchor(null)} anchorOrigin={{ vertical: 'top', horizontal: 'left' }} transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}>
        <Stack direction="row" spacing={1} sx={{ p: 1.5, alignItems: 'center' }} onKeyDown={enterToSubmit(apply)}>
          <TextField size="small" type="number" label={t('status.rangeStart')} value={draft.start} onChange={(e) => setDraft({ ...draft, start: e.target.value })} slotProps={{ htmlInput: { step: 0.01, min: 0 } }} sx={{ width: 120 }} />
          <TextField size="small" type="number" label={t('status.rangeEnd')} value={draft.end} onChange={(e) => setDraft({ ...draft, end: e.target.value })} slotProps={{ htmlInput: { step: 0.01, min: 0 } }} sx={{ width: 120 }} />
          <Button onClick={apply}>{t('common.ok')}</Button>
          {r && <Button onClick={() => (p.onChange(null), setAnchor(null))}>{t('status.clearRange')}</Button>}
        </Stack>
      </Popover>
    </>
  )
}

export default function StatusBar(p: {
  fileName: string
  dirty: boolean
  onRename: (name: string) => void
  sampleRate: number
  tracks: number
  range: Range | null
  onRange: (r: Range | null) => void
  bpm: number
  /** BPM の表示と入力（PevenMUI の TempoField。WeVocalSynth と同じ） */
  tempo: ReactNode
}) {
  const t = useT()
  const [renaming, setRenaming] = useState<string | null>(null)
  const rename = () => {
    if (renaming?.trim()) p.onRename(renaming.trim())
    setRenaming(null)
  }
  return (
    <Bar>
      {/* プロジェクト名。押すと名前を変えられる（保存と書き出しのファイル名になる） */}
      <StatusButton title={t('status.renameHint')} onClick={() => setRenaming(p.fileName)}>
        {p.fileName || '—'}
        {p.dirty && ' *'}
      </StatusButton>
      <StatusItem secondary>
        {p.sampleRate} Hz・Stereo・{t('status.tracks', { n: p.tracks })}
      </StatusItem>
      <SelectionField range={p.range} bpm={p.bpm} onChange={p.onRange} />
      {p.tempo}
      <StatusSpacer />
      {/* 処理中の進み具合（ピッチなどを作る、書き出し。PevenMUI の JobGauge。WeVocalSynth と同じ） */}
      <JobGauge<string> kindLabel={(k) => t(`job.${k}` as Parameters<typeof t>[0])} />
      <Dialog open={renaming !== null} onClose={() => setRenaming(null)} maxWidth="xs" fullWidth onKeyDown={enterToSubmit(rename)}>
        <DialogContent>
          <TextField autoFocus fullWidth size="small" label={t('status.projectName')} value={renaming ?? ''} onChange={(e) => setRenaming(e.target.value)} sx={{ mt: 1 }} />
        </DialogContent>
        <DialogActions>
          <Box sx={{ flex: 1 }} />
          <Button onClick={() => setRenaming(null)}>{t('common.cancel')}</Button>
          <Button onClick={rename}>{t('common.ok')}</Button>
        </DialogActions>
      </Dialog>
    </Bar>
  )
}
