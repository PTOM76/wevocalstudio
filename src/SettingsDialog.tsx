// 設定画面（外枠は PevenMUI の SettingsDialog）
import { ALGORITHM_NAMES, type Algorithm } from 'wevocal-lib'
import { Check, Choice, Group, Row, SettingsDialog as PevenSettingsDialog, type SettingsCategory } from 'pevenmui'
import { i18n, useT, type LangSetting } from './i18n'
import type { GridMode } from './grid'
import { DEFAULT_SETTINGS, type Settings } from './settings'

type Category = 'general' | 'appearance' | 'edit' | 'pitch'

const SCALES: ['0.9' | '1' | '1.1' | '1.25', string][] = [
  ['0.9', '90%'],
  ['1', '100%'],
  ['1.1', '110%'],
  ['1.25', '125%'],
]

/** 設定画面（外枠は PevenMUI の SettingsDialog） */
export default function SettingsDialog(p: { open: boolean; onClose: () => void; settings: Settings; onChange: (patch: Partial<Settings>) => void }) {
  const t = useT()
  // texts は設定の検索の対象。項目を足したらここにも足す
  const categories: SettingsCategory<Category>[] = [
    { id: 'general', label: t('settings.general'), texts: [t('settings.language'), t('settings.autoRestore')] },
    { id: 'appearance', label: t('settings.appearance'), texts: [t('settings.theme'), t('settings.uiScale')] },
    { id: 'edit', label: t('settings.edit'), texts: [t('settings.snap'), t('settings.grid')] },
    { id: 'pitch', label: t('settings.pitch'), texts: [t('settings.algorithm'), t('settings.preserveFormant')] },
  ]
  return (
    <PevenSettingsDialog
      open={p.open}
      onClose={p.onClose}
      title={t('settings.title')}
      settings={p.settings}
      defaults={DEFAULT_SETTINGS}
      onChange={p.onChange}
      categories={categories}
      pages={(draft, set) => ({
        general: (
          <Group title={t('settings.general')}>
            <Row label={t('settings.language')}>
              <Choice<LangSetting> value={draft.language} onChange={(language) => set({ language })} options={[['auto', t('settings.languageAuto')], ...i18n.options()]} />
            </Row>
            <Check label={t('settings.autoRestore')} checked={draft.autoRestore} onChange={(autoRestore) => set({ autoRestore })} />
          </Group>
        ),
        appearance: (
          <Group title={t('settings.appearance')}>
            <Row label={t('settings.theme')}>
              <Choice<Settings['theme']>
                value={draft.theme}
                onChange={(theme) => set({ theme })}
                options={[
                  ['system', t('settings.themeSystem')],
                  ['light', t('settings.themeLight')],
                  ['dark', t('settings.themeDark')],
                ]}
              />
            </Row>
            <Row label={t('settings.uiScale')}>
              <Choice value={String(draft.uiScale) as (typeof SCALES)[number][0]} onChange={(v) => set({ uiScale: Number(v) })} options={SCALES} />
            </Row>
          </Group>
        ),
        edit: (
          <Group title={t('settings.edit')}>
            <Check label={t('settings.snap')} help={t('settings.snapHelp')} checked={draft.snap} onChange={(snap) => set({ snap })} />
            <Row label={t('settings.grid')}>
              <Choice<GridMode> value={draft.grid} onChange={(grid) => set({ grid })} options={[['beats', t('settings.gridBeats')], ['time', t('settings.gridTime')]]} />
            </Row>
          </Group>
        ),
        pitch: (
          <Group title={t('settings.pitch')}>
            <Row label={t('settings.algorithm')}>
              <Choice<Algorithm> value={draft.algorithm} onChange={(algorithm) => set({ algorithm })} options={Object.entries(ALGORITHM_NAMES) as [Algorithm, string][]} />
            </Row>
            <Check label={t('settings.preserveFormant')} checked={draft.preserveFormant} onChange={(preserveFormant) => set({ preserveFormant })} />
          </Group>
        ),
      })}
    />
  )
}
