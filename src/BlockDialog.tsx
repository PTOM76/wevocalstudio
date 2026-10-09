// 波形ブロックのプロパティ（REAPER のアイテムのプロパティ）。複数を選んでいれば一括で変える（触った欄だけを全部に掛ける）。元の音も選び直せる
import { useEffect, useState } from 'react'
import { Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, MenuItem, Stack, TextField, Typography } from '@mui/material'
import { enterToSubmit } from 'pevenmui'
import { ALGORITHM_NAMES, type Algorithm } from 'wevocal-lib'
import { useT, type MessageKey } from './i18n'
import { RATE_MAX, RATE_MIN, type Block, type Source } from './project'

type NumberKey = 'start' | 'length' | 'offset' | 'rate' | 'gain' | 'pitch' | 'formant' | 'fadeIn' | 'fadeOut'

/** 数値で指定する項目（名前、刻み、下限、上限） */
const NUMBERS: [NumberKey, MessageKey, number, number, number][] = [
  ['start', 'block.start', 0.001, 0, Infinity],
  ['length', 'block.length', 0.001, 0.01, Infinity],
  ['offset', 'block.offset', 0.001, 0, Infinity],
  ['rate', 'block.rate', 0.01, RATE_MIN, RATE_MAX],
  ['gain', 'block.gain', 0.1, -60, 24],
  ['pitch', 'block.pitch', 0.01, -24, 24],
  ['formant', 'block.formant', 0.1, -12, 12],
  ['fadeIn', 'block.fadeIn', 0.01, 0, Infinity],
  ['fadeOut', 'block.fadeOut', 0.01, 0, Infinity],
]

/** 変えた値（触った欄だけ） */
export type BlockEdit = Partial<Pick<Block, NumberKey | 'algorithm' | 'preserveFormant' | 'mute' | 'source'>>

/** みんな同じ値ならそれ、違えば null（空の欄にする） */
function common<K extends keyof Block>(blocks: Block[], key: K): Block[K] | null {
  return blocks.every((b) => b[key] === blocks[0][key]) ? blocks[0][key] : null
}

export default function BlockDialog(p: {
  blocks: Block[]
  sources: Source[]
  onClose: () => void
  onApply: (edit: BlockEdit) => void
  /** ファイルから元の音を読み込んで選ぶ */
  onPickFile: () => void
}) {
  const t = useT()
  const [edit, setEdit] = useState<BlockEdit>({})
  const [text, setText] = useState<Partial<Record<NumberKey, string>>>({})
  const open = p.blocks.length > 0
  useEffect(() => {
    setEdit({})
    setText({})
  }, [open])
  if (!open) return <Dialog open={false} />

  const many = p.blocks.length > 1
  const value = <K extends keyof BlockEdit>(key: K) => (key in edit ? edit[key] : common(p.blocks, key as keyof Block)) as Block[K] | null
  const apply = () => {
    p.onApply(edit)
    p.onClose()
  }
  const source = value('source')

  return (
    <Dialog open onClose={p.onClose} maxWidth="xs" fullWidth onKeyDown={enterToSubmit(apply)}>
      <DialogTitle>{many ? t('block.propertiesMany', { n: p.blocks.length }) : t('block.properties')}</DialogTitle>
      <DialogContent>
        {many && (
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>
            {t('block.manyHelp')}
          </Typography>
        )}
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            select
            size="small"
            label={t('block.source')}
            value={source ?? ''}
            onChange={(e) => (e.target.value === '__file' ? p.onPickFile() : setEdit({ ...edit, source: e.target.value }))}
          >
            {p.sources.map((s) => (
              <MenuItem key={s.id} value={s.id}>
                {s.name}
              </MenuItem>
            ))}
            <MenuItem value="__file">{t('block.sourceFile')}</MenuItem>
          </TextField>
          <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 2 }}>
            {NUMBERS.filter(([key]) => !many || (key !== 'start' && key !== 'offset')).map(([key, label, step, min, max]) => {
              const v = value(key)
              return (
                <TextField
                  key={key}
                  size="small"
                  type="number"
                  label={t(label)}
                  value={text[key] ?? (v === null ? '' : String(v))}
                  placeholder={v === null ? t('block.mixed') : undefined}
                  slotProps={{ htmlInput: { step, min, max: Number.isFinite(max) ? max : undefined }, inputLabel: { shrink: true } }}
                  onChange={(e) => {
                    setText({ ...text, [key]: e.target.value })
                    const n = Number(e.target.value)
                    if (e.target.value === '' || !Number.isFinite(n)) return
                    setEdit({ ...edit, [key]: Math.max(min, Math.min(max, n)) })
                  }}
                  sx={{ width: 150 }}
                />
              )
            })}
          </Stack>
          <TextField select size="small" label={t('block.algorithm')} value={value('algorithm') ?? ''} onChange={(e) => setEdit({ ...edit, algorithm: e.target.value as Algorithm })}>
            {(Object.entries(ALGORITHM_NAMES) as [Algorithm, string][]).map(([id, name]) => (
              <MenuItem key={id} value={id}>
                {name}
              </MenuItem>
            ))}
          </TextField>
          <Stack direction="row" sx={{ flexWrap: 'wrap' }}>
            {(['preserveFormant', 'mute'] as const).map((key) => (
              <FormControlLabel
                key={key}
                control={<Checkbox checked={value(key) === true} indeterminate={value(key) === null} onChange={(e) => setEdit({ ...edit, [key]: e.target.checked })} />}
                label={t(key === 'mute' ? 'block.mute' : 'block.preserveFormant')}
              />
            ))}
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={p.onClose}>{t('common.cancel')}</Button>
        <Button onClick={apply}>{t('common.ok')}</Button>
      </DialogActions>
    </Dialog>
  )
}
