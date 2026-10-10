// 設定画面（外枠は PevenMUI の SettingsDialog）
import { useEffect, useState } from 'react'
import { ALGORITHM_NAMES, listInputDevices, type Algorithm, type InputDevice } from 'wevocal-lib'
import { Check, Choice, Group, KeymapEditor, Row, SettingsDialog as PevenSettingsDialog, type SettingsCategory } from 'pevenmui'
import { i18n, useT, type LangSetting, type MessageKey } from './i18n'
import { ACTIONS } from './keymap'
import type { GridMode } from './grid'
import type { StartFolder } from 'pevenmui/web'
import { DEFAULT_SETTINGS, type Settings } from './settings'

type Category = 'general' | 'file' | 'appearance' | 'edit' | 'pitch' | 'record' | 'keys'

const SCALES: ['0.9' | '1' | '1.1' | '1.25', string][] = [
  ['0.9', '90%'],
  ['1', '100%'],
  ['1.1', '110%'],
  ['1.25', '125%'],
]

/** 設定画面（外枠は PevenMUI の SettingsDialog） */
export default function SettingsDialog(p: { open: boolean; onClose: () => void; settings: Settings; onChange: (patch: Partial<Settings>) => void }) {
  const t = useT()
  // 録音の入力元の一覧（設定を開いたときに読む。名前はマイクを許可するまで出ないことがある）
  const [inputs, setInputs] = useState<InputDevice[]>([])
  useEffect(() => {
    if (p.open) listInputDevices().then(setInputs, () => setInputs([]))
  }, [p.open])
  // 操作の名前はメニューと同じ（menu.<操作の名前>）
  const keyActions = ACTIONS.map((a) => ({ ...a, label: t(`menu.${a.id}` as MessageKey) }))
  // texts は設定の検索の対象。項目を足したらここにも足す
  const categories: SettingsCategory<Category>[] = [
    { id: 'general', label: t('settings.general'), texts: [t('settings.language'), t('settings.autoRestore'), t('settings.confirmClose')] },
    { id: 'file', label: t('settings.file'), texts: [t('settings.rememberFolder'), t('settings.startFolder'), t('settings.recentFiles')] },
    { id: 'appearance', label: t('settings.appearance'), texts: [t('settings.theme'), t('settings.uiScale')] },
    { id: 'edit', label: t('settings.edit'), texts: [t('settings.snap'), t('settings.grid')] },
    { id: 'record', label: t('settings.record'), texts: [t('settings.inputDevice')] },
    { id: 'keys', label: t('settings.keys'), texts: keyActions.map((a) => a.label) },
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
            <Check label={t('settings.confirmClose')} help={t('settings.confirmCloseHelp')} checked={draft.confirmClose} disabled={draft.autoRestore} onChange={(confirmClose) => set({ confirmClose })} />
          </Group>
        ),
        file: (
          <Group title={t('settings.file')}>
            <Check label={t('settings.rememberFolder')} help={t('settings.rememberFolderHelp')} checked={draft.rememberFolder} onChange={(rememberFolder) => set({ rememberFolder })} />
            <Row label={t('settings.startFolder')}>
              <Choice<StartFolder>
                value={draft.startFolder}
                onChange={(startFolder) => set({ startFolder })}
                options={[
                  ['downloads', t('settings.folderDownloads')],
                  ['documents', t('settings.folderDocuments')],
                  ['desktop', t('settings.folderDesktop')],
                  ['music', t('settings.folderMusic')],
                ]}
              />
            </Row>
            <Check label={t('settings.recentFiles')} help={t('settings.recentFilesHelp')} checked={draft.recentFiles} onChange={(recentFiles) => set({ recentFiles })} />
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
        record: (
          <Group title={t('settings.record')}>
            <Row label={t('settings.inputDevice')}>
              <Choice<string> value={draft.inputDevice} onChange={(inputDevice) => set({ inputDevice })} options={[['', t('settings.inputDefault')], ...inputs.map((d) => [d.id, d.label] as [string, string])]} />
            </Row>
          </Group>
        ),
        keys: (
          <Group title={t('settings.keys')}>
            <KeymapEditor actions={keyActions} overrides={draft.keys} onChange={(keys) => set({ keys })} />
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
