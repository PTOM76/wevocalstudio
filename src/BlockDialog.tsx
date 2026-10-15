// 波形ブロックのプロパティ。複数を選んでいれば一括で変える（触った欄だけを全部に掛ける）。元の音も選び直せる
import { useEffect, useState } from 'react'
import { Box, Button, Checkbox, ListItemText, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, MenuItem, Stack, TextField, Typography } from '@mui/material'
import { PresetMenu, enterToSubmit, type Preset } from 'pevenmui'
import { visibleAlgorithms, type Algorithm } from 'wevocal-lib'
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
  ['pitch', 'block.pitch', 0.01, -256, 256],
  ['formant', 'block.formant', 0.1, -12, 12],
  ['fadeIn', 'block.fadeIn', 0.01, 0, Infinity],
  ['fadeOut', 'block.fadeOut', 0.01, 0, Infinity],
]

/** 変えた値（触った欄だけ） */
export type BlockEdit = Partial<Pick<Block, NumberKey | 'algorithm' | 'preserveFormant' | 'mute' | 'source'>>

/** プリセットに覚える値（音の作り方。位置や長さは覚えない） */
export type BlockPreset = Partial<Pick<Block, 'rate' | 'gain' | 'pitch' | 'formant' | 'algorithm' | 'preserveFormant'>>
const PRESET_KEYS = ['rate', 'gain', 'pitch', 'formant', 'algorithm', 'preserveFormant'] as const

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
  /** プリセット（設定に覚える。PevenMUI の PresetMenu。WeVocalSynth の加工のプリセットと同じ） */
  presets: Preset<BlockPreset>[]
  onPresetsChange: (presets: Preset<BlockPreset>[]) => void
  /** 従来の処理方式も表示する（設定） */
  showLegacy: boolean
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
  // 今の値（みんな違う項目は覚えない）と、プリセットを呼び出したときに欄へ入れる
  const current = Object.fromEntries(PRESET_KEYS.flatMap((k) => (value(k) === null ? [] : [[k, value(k)]]))) as BlockPreset
  const applyPreset = (pr: BlockPreset) => {
    setEdit((e) => ({ ...e, ...pr }))
    setText((s) => ({ ...s, ...Object.fromEntries(Object.entries(pr).filter(([, v]) => typeof v === 'number').map(([k, v]) => [k, String(v)])) }))
  }

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
            {/* 処理方式の一覧（wevocal-lib。WeVocalSynth と同じ名前と説明）。従来の方式は設定で表示したときか、今使っているときだけ */}
            {visibleAlgorithms(p.showLegacy, p.blocks.map((b) => b.algorithm)).map((a) => (
              <MenuItem key={a.value} value={a.value}>
                <ListItemText primary={t(a.label)} secondary={t(a.hint)} />
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
        <PresetMenu
          params={current}
          presets={p.presets}
          onApply={applyPreset}
          onChange={p.onPresetsChange}
          labels={{ button: t('preset.button'), empty: t('preset.empty'), save: t('preset.save'), remove: t('preset.remove'), defaultName: (n) => t('preset.defaultName', { n }) }}
        />
        <Box sx={{ flex: 1 }} />
        <Button onClick={p.onClose}>{t('common.cancel')}</Button>
        <Button onClick={apply}>{t('common.ok')}</Button>
      </DialogActions>
    </Dialog>
  )
}
