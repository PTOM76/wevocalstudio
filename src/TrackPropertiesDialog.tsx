// 選択中のトラックの共通プロパティをまとめて編集する
import { useEffect, useState } from 'react'
import { Checkbox, DialogActions, DialogContent, FormControlLabel, Stack, TextField, Typography, Button } from '@mui/material'
import { WindowDialog, enterToSubmit, useMobileLayout } from 'pevenmui'
import { useT, type MessageKey } from './i18n'
import type { Track } from './project'

type NumberKey = 'volume' | 'pan'
type BooleanKey = 'mute' | 'solo' | 'invert'
export type TrackPropertyEdit = Partial<Pick<Track, NumberKey | BooleanKey | 'name'>>
export type TrackPropertyAdd = Partial<Record<NumberKey, number>>

const LIMITS: Record<NumberKey, [number, number, number]> = {
  volume: [0.1, -60, 12],
  pan: [0.01, -1, 1],
}

function commonNumber(tracks: Track[], key: NumberKey): number | null {
  return tracks.every((track) => track[key] === tracks[0][key]) ? tracks[0][key] : null
}

function commonBoolean(tracks: Track[], key: BooleanKey): boolean | null {
  const value = (track: Track) => (key === 'invert' ? !!track.invert : track[key])
  return tracks.every((track) => value(track) === value(tracks[0])) ? value(tracks[0]) : null
}

export default function TrackPropertiesDialog(p: {
  open: boolean
  tracks: Track[]
  onClose: () => void
  onApply: (edit: TrackPropertyEdit, add: TrackPropertyAdd) => void
}) {
  const t = useT()
  // 画面の端の欄に置ける（スマホは欄がないので、ダイアログのまま）
  const mobile = useMobileLayout()
  const [edit, setEdit] = useState<TrackPropertyEdit>({})
  const [add, setAdd] = useState<TrackPropertyAdd>({})
  const [text, setText] = useState<Partial<Record<NumberKey, string>>>({})
  const [nameText, setNameText] = useState<string | null>(null)
  const ids = p.tracks.map((track) => track.id).join(',')

  useEffect(() => {
    setEdit({})
    setAdd({})
    setText({})
    setNameText(null)
  }, [p.open, ids])

  if (!p.open || !p.tracks.length) return null

  const apply = () => {
    p.onApply(edit, add)
    p.onClose()
  }
  const numberField = (key: NumberKey) => {
    const value = commonNumber(p.tracks, key)
    const mixed = value === null
    const [step, min, max] = LIMITS[key]
    return (
      <TextField
        key={key}
        size="small"
        type={mixed ? 'text' : 'number'}
        slotProps={{ htmlInput: mixed ? { inputMode: 'decimal' } : { step, min, max }, inputLabel: { shrink: true } }}
        label={t(key === 'volume' ? 'track.volume' : 'track.pan')}
        value={text[key] ?? (value === null ? '' : String(value))}
        placeholder={mixed ? t('track.mixed') : undefined}
        onChange={(event) => setNumber(key, event.target.value)}
      />
    )
  }
  function setNumber(key: NumberKey, raw: string) {
    setText((state) => ({ ...state, [key]: raw }))
    const str = raw.trim()
    const value = Number(str)
    const withoutKey = <T extends object>(state: T): T => Object.fromEntries(Object.entries(state).filter(([name]) => name !== key)) as T
    if (!str || !Number.isFinite(value)) {
      setEdit(withoutKey)
      setAdd(withoutKey)
      return
    }
    if (commonNumber(p.tracks, key) === null && (str[0] === '+' || str[0] === '-')) {
      setAdd((state) => ({ ...state, [key]: value }))
      setEdit(withoutKey)
      return
    }
    const [, min, max] = LIMITS[key]
    setEdit((state) => ({ ...state, [key]: Math.max(min, Math.min(max, value)) }))
    setAdd(withoutKey)
  }
  const booleanField = (key: BooleanKey, label: MessageKey) => {
    const value = edit[key] ?? commonBoolean(p.tracks, key)
    return (
      <FormControlLabel
        key={key}
        label={t(label)}
        control={
          <Checkbox
            checked={value === true}
            indeterminate={value === null}
            onChange={(_, checked) => setEdit((state) => ({ ...state, [key]: checked }))}
          />
        }
      />
    )
  }

  return (
    <WindowDialog
      open
      onClose={p.onClose}
      title={p.tracks.length > 1 ? t('track.propertiesMany', { n: p.tracks.length }) : t('track.properties')}
      name="trackProperties"
      dockable={!mobile}
      width={400}
      height={390}
      onKeyDown={enterToSubmit(apply)}
      dialogProps={{ maxWidth: 'xs', fullWidth: true }}
    >
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography variant="body2" color="text.secondary">{t('track.propertiesHelp')}</Typography>
          <TextField
            size="small"
            label={t('track.displayName')}
            value={nameText ?? (edit.name ?? (p.tracks.every((track) => track.name === p.tracks[0].name) ? p.tracks[0].name : ''))}
            placeholder={p.tracks.every((track) => track.name === p.tracks[0].name) ? undefined : t('track.mixed')}
            onChange={(event) => {
              const raw = event.target.value
              setNameText(raw)
              const name = raw.trim()
              setEdit((state) => {
                if (name) return { ...state, name }
                const { name: _, ...rest } = state
                return rest
              })
            }}
          />
          <Stack direction="row" spacing={1.5}>
            {numberField('volume')}
            {numberField('pan')}
          </Stack>
          <Stack>
            {booleanField('mute', 'track.mute')}
            {booleanField('solo', 'track.solo')}
            {booleanField('invert', 'track.invert')}
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={p.onClose}>{t('common.cancel')}</Button>
        <Button variant="contained" onClick={apply}>{t('common.ok')}</Button>
      </DialogActions>
    </WindowDialog>
  )
}
