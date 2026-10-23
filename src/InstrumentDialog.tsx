// トラックの音源（MIDI ブロックの音符を鳴らすプラグイン）の選択とつまみ。サンプラーは音色にする元の音（プロジェクトの元の音から）も選ぶ
import { Box, Button, DialogActions, DialogContent, Typography } from '@mui/material'
import { WindowDialog, pevenFont, useMobileLayout } from 'pevenmui'
import { FxParams, LabeledSelect as Choice } from 'wevocal-lib/react'
import { availableInstruments, defaultValues, findInstrument, fxDescription, fxText, migrateValues } from 'wevocal-lib'
import { i18n, useT } from './i18n'
import type { InstrumentSlot, Project } from './project'

export default function InstrumentDialog(p: { open: boolean; project: Project; track: string; onChange: (instrument: InstrumentSlot | undefined) => void; onClose: () => void }) {
  const t = useT()
  // 画面の端の欄に置ける（スマホは欄がないので、ダイアログのまま）
  const mobile = useMobileLayout()
  const lang = i18n.useLang()
  const track = p.project.tracks.find((x) => x.id === p.track)
  const slot = track?.instrument
  const plugin = slot && findInstrument(slot.plugin)
  const NONE = ''
  const list = availableInstruments()
  const values = plugin && slot ? migrateValues(plugin.manifest, slot.values) : {}
  return (
    <WindowDialog open={p.open} onClose={p.onClose} title={t('instrument.title', { name: track?.name ?? '' })} name="instrument" dockable={!mobile} width={560} height={520} dialogProps={{ fullWidth: true, maxWidth: 'sm' }}>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Typography sx={{ fontSize: pevenFont('sm'), color: 'text.secondary' }}>{t('instrument.help')}</Typography>
          <Choice
            label={t('instrument.plugin')}
            value={slot?.plugin ?? NONE}
            options={[[NONE, t('instrument.none')], ...list.map((x): [string, string] => [x.manifest.id, fxText(x, 'name', lang)])]}
            onChange={(id) => {
              const next = id ? findInstrument(id) : undefined
              p.onChange(next ? { plugin: id, values: defaultValues(next.manifest), ...(next.sample && p.project.sources[0] ? { sample: p.project.sources[0].id } : {}) } : undefined)
            }}
          />
          {plugin && <Typography sx={{ fontSize: pevenFont('sm'), color: 'text.secondary' }}>{fxDescription(plugin, lang)}</Typography>}
          {plugin?.sample && (
            <Choice
              label={t('instrument.sample')}
              value={slot?.sample ?? NONE}
              options={[[NONE, t('instrument.noSample')], ...p.project.sources.map((s): [string, string] => [s.id, s.name])]}
              onChange={(id) => slot && p.onChange({ ...slot, sample: id || undefined })}
            />
          )}
          {plugin && slot && <FxParams plugin={{ manifest: plugin.manifest, lang: plugin.lang, create: () => null as never }} values={values} lang={lang} onChange={(id, v) => p.onChange({ ...slot, values: { ...values, [id]: v } })} />}
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
