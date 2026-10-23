// 波形ブロックのプロパティ。複数を選んでいれば一括で変える（触った欄だけを全部に掛ける）。元の音も選び直せる
import { useEffect, useState } from 'react'
import { Box, Button, Checkbox, ListItemText, DialogActions, DialogContent, FormControlLabel, MenuItem, Slider, Stack, TextField, Typography } from '@mui/material'
import { PresetMenu, WindowDialog, enterToSubmit, type Preset, useMobileLayout } from 'pevenmui'
import { visibleAlgorithms, type Algorithm } from 'wevocal-lib'
import { useT, type MessageKey } from './i18n'
import { BLOCK_LIMITS, type Block, type Source } from './project'

type NumberKey = 'start' | 'length' | 'offset' | 'rate' | 'gain' | 'pitch' | 'formant' | 'fadeIn' | 'fadeOut'

/** 数値で指定する項目（ラベル、刻み、下限、上限） */
const NUMBERS: Record<NumberKey, [MessageKey, number, number, number]> = {
  start: ['block.start', 0.001, ...BLOCK_LIMITS.start],
  length: ['block.length', 0.001, ...BLOCK_LIMITS.length],
  offset: ['block.offset', 0.001, ...BLOCK_LIMITS.offset],
  rate: ['block.rate', 0.01, ...BLOCK_LIMITS.rate],
  gain: ['block.gain', 0.1, ...BLOCK_LIMITS.gain],
  pitch: ['block.pitch', 0.01, ...BLOCK_LIMITS.pitch],
  formant: ['block.formant', 0.1, ...BLOCK_LIMITS.formant],
  fadeIn: ['block.fadeIn', 0.01, ...BLOCK_LIMITS.fadeIn],
  fadeOut: ['block.fadeOut', 0.01, ...BLOCK_LIMITS.fadeOut],
}

/** 分類ごとの数値の欄（複数を選んでいるときは位置と元の音の開始位置を出さない） */
const SECTIONS: { title: MessageKey; keys: NumberKey[] }[] = [
  { title: 'block.sectionPlace', keys: ['start', 'length', 'offset'] },
  { title: 'block.sectionPitchSpeed', keys: ['rate', 'pitch', 'formant'] },
  { title: 'block.sectionVolume', keys: ['gain', 'fadeIn', 'fadeOut'] },
]

/** 変えた値（触った欄だけ） */
export type BlockEdit = Partial<Pick<Block, NumberKey | 'algorithm' | 'preserveFormant' | 'mute' | 'source'>> & { name?: string | undefined }

/** 混在の欄に足し引きした値（+1、-1 のように入力した分。ブロックごとの今の値に足す） */
export type BlockAdd = Partial<Record<NumberKey, number>>

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
  onApply: (edit: BlockEdit, add: BlockAdd) => void
  /** ファイルから元の音を読み込んで選ぶ */
  onPickFile: () => void
  /** プリセット（設定に覚える。PevenMUI の PresetMenu。WeVocalSynth の加工のプリセットと同じ） */
  presets: Preset<BlockPreset>[]
  onPresetsChange: (presets: Preset<BlockPreset>[]) => void
  /** 従来の処理方式も表示する（設定） */
  showLegacy: boolean
}) {
  const t = useT()
  // 画面の端の欄に置ける（スマホは欄がないので、ダイアログのまま）
  const mobile = useMobileLayout()
  const [edit, setEdit] = useState<BlockEdit>({})
  const [add, setAdd] = useState<BlockAdd>({})
  const [text, setText] = useState<Partial<Record<NumberKey, string>>>({})
  const [nameText, setNameText] = useState<string | null>(null)
  const open = p.blocks.length > 0
  useEffect(() => {
    setEdit({})
    setAdd({})
    setText({})
    setNameText(null)
  }, [open])
  if (!open) return null

  const many = p.blocks.length > 1
  const value = <K extends keyof BlockEdit>(key: K) => (key in edit ? edit[key] : common(p.blocks, key as keyof Block)) as Block[K] | null
  const apply = () => {
    p.onApply(edit, add)
    p.onClose()
  }
  const source = value('source')
  const name = value('name')
  const inferredName = !many && p.blocks[0] ? p.sources.find((s) => s.id === p.blocks[0].source)?.name : undefined
  // 今の値（みんな違う項目は覚えない）と、プリセットを呼び出したときに欄へ入れる
  const current = Object.fromEntries(PRESET_KEYS.flatMap((k) => (value(k) === null ? [] : [[k, value(k)]]))) as BlockPreset
  const applyPreset = (pr: BlockPreset) => {
    setEdit((e) => ({ ...e, ...pr }))
    setText((s) => ({
      ...s,
      ...Object.fromEntries(
        Object.entries(pr)
          .filter(([, v]) => typeof v === 'number')
          .map(([k, v]) => [k, String(v)]),
      ),
    }))
  }

  const field = (key: NumberKey) => {
    const [label, step, min, max] = NUMBERS[key]
    const v = value(key)
    const mixed = common(p.blocks, key) === null
    return (
      <TextField
        key={key}
        size="small"
        // 混在の欄は +1、-1 のような足し引きも入力できるよう、文字の欄にする（数の欄は + を受け付けない）
        type={mixed ? 'text' : 'number'}
        slotProps={{
          htmlInput: mixed ? { inputMode: 'decimal' } : { step, min, max: Number.isFinite(max) ? max : undefined },
          inputLabel: { shrink: true },
        }}
        label={t(label)}
        value={text[key] ?? (v === null ? '' : String(v))}
        placeholder={v === null ? t('block.mixed') : undefined}
        onChange={(e) => setNumber(key, e.target.value)}
      />
    )
  }
  /** 欄の文字と値を一緒に変える（スライダーからも使う） */
  function setNumber(key: NumberKey, raw: string) {
    setText((s) => ({ ...s, [key]: raw }))
    const str = raw.trim()
    const n = Number(str)
    const drop = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([k]) => k !== key)) as T
    if (str === '' || !Number.isFinite(n)) {
      // 空にしたら、その欄は触っていないことにする
      setEdit(drop)
      setAdd(drop)
      return
    }
    // 混在の欄で +1、-1 のように符号を付けたら、それぞれの値に足し引きする
    if (common(p.blocks, key) === null && (str[0] === '+' || str[0] === '-')) {
      setAdd((a) => ({ ...a, [key]: n }))
      setEdit(drop)
      return
    }
    const [, , min, max] = NUMBERS[key]
    setEdit((e) => ({ ...e, [key]: Math.max(min, Math.min(max, n)) }))
    setAdd(drop)
  }
  const heading = (title: MessageKey) => (
    <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>
      {t(title)}
    </Typography>
  )
  const grid = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
    gap: 1.5,
  }
  const gain = value('gain')

  return (
    <WindowDialog
      open
      onClose={p.onClose}
      title={many ? t('block.propertiesMany', { n: p.blocks.length }) : t('block.properties')}
      name="blockProperties"
      dockable={!mobile}
      width={480}
      height={many ? 600 : 680}
      onKeyDown={enterToSubmit(apply)}
      dialogProps={{ maxWidth: 'xs', fullWidth: true }}
    >
      <DialogContent>
        {many && (
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>
            {t('block.manyHelp')}
          </Typography>
        )}
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          <TextField
            size="small"
            label={t('block.displayName')}
            value={nameText ?? (name || '')}
            placeholder={name === null ? t('block.mixed') : inferredName}
            helperText={t('block.nameHint')}
            onChange={(e) => {
              const raw = e.target.value
              setNameText(raw)
              setEdit((current) => ({ ...current, name: raw.trim() || undefined }))
            }}
          />
          <Stack spacing={1.5}>
            {heading('block.sectionSource')}
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
          </Stack>
          {SECTIONS.map(({ title, keys }) => {
            const shown = keys.filter((k) => !many || (k !== 'start' && k !== 'offset'))
            return (
              <Stack key={title} spacing={1.5}>
                {heading(title)}
                {title === 'block.sectionVolume' && (
                  // 音量はスライダーでも変える（ダブルクリックで 0 dB。みんな違うときは動かすまで触らない）
                  <Slider
                    size="small"
                    aria-label={t('block.gain')}
                    min={NUMBERS.gain[2]}
                    max={NUMBERS.gain[3]}
                    step={0.1}
                    value={gain ?? 0}
                    onChange={(_, v) => setNumber('gain', String(Array.isArray(v) ? v[0] : v))}
                    onDoubleClick={() => setNumber('gain', '0')}
                    sx={{ mx: 1, width: 'auto' }}
                  />
                )}
                <Box sx={grid}>{shown.map(field)}</Box>
                {title === 'block.sectionPitchSpeed' && (
                  <>
                    <TextField
                      select
                      size="small"
                      label={t('block.algorithm')}
                      value={value('algorithm') ?? ''}
                      // 選ぶ一覧には説明を付け、閉じているときは名前だけにする
                      slotProps={{
                        select: {
                          renderValue: (v) => {
                            const a = visibleAlgorithms(
                              p.showLegacy,
                              p.blocks.map((b) => b.algorithm),
                            ).find((x) => x.value === v)
                            return a ? t(a.label) : ''
                          },
                        },
                      }}
                      onChange={(e) =>
                        setEdit({
                          ...edit,
                          algorithm: e.target.value as Algorithm,
                        })
                      }
                    >
                      {/* 処理方式の一覧（wevocal-lib。WeVocalSynth と同じ名前と説明）。従来の方式は設定で表示したときか、今使っているときだけ */}
                      {visibleAlgorithms(
                        p.showLegacy,
                        p.blocks.map((b) => b.algorithm),
                      ).map((a) => (
                        <MenuItem key={a.value} value={a.value}>
                          <ListItemText primary={t(a.label)} secondary={t(a.hint)} />
                        </MenuItem>
                      ))}
                    </TextField>
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={value('preserveFormant') === true}
                          indeterminate={value('preserveFormant') === null}
                          onChange={(e) =>
                            setEdit({
                              ...edit,
                              preserveFormant: e.target.checked,
                            })
                          }
                        />
                      }
                      label={t('block.preserveFormant')}
                    />
                  </>
                )}
                {title === 'block.sectionVolume' && (
                  <FormControlLabel
                    control={<Checkbox checked={value('mute') === true} indeterminate={value('mute') === null} onChange={(e) => setEdit({ ...edit, mute: e.target.checked })} />}
                    label={t('block.mute')}
                  />
                )}
              </Stack>
            )
          })}
        </Stack>
      </DialogContent>
      <DialogActions>
        <PresetMenu
          params={current}
          presets={p.presets}
          onApply={applyPreset}
          onChange={p.onPresetsChange}
          labels={{
            button: t('preset.button'),
            empty: t('preset.empty'),
            save: t('preset.save'),
            remove: t('preset.remove'),
            defaultName: (n) => t('preset.defaultName', { n }),
          }}
        />
        <Box sx={{ flex: 1 }} />
        <Button onClick={p.onClose}>{t('common.cancel')}</Button>
        <Button onClick={apply}>{t('common.ok')}</Button>
      </DialogActions>
    </WindowDialog>
  )
}
