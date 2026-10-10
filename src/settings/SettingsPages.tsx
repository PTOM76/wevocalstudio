// 設定画面の分類ごとの中身（定義のある項目は S(名前) の 1 行。WeVocalSynth と同じ形）
import { useEffect, useState, type ReactNode } from 'react'
import { ALGORITHM_NAMES, listInputDevices, type Algorithm, type InputDevice } from 'wevocal-lib'
import { Choice, Group, KeymapEditor, Row, type WindowMode } from 'pevenmui'
import { UpdateSection } from 'pevenmui/pwa'
import { OutputDeviceRow } from 'wevocal-lib/react'
import { i18n, type LangSetting, type MessageKey } from '../i18n'
import { ACTIONS } from '../keymap'
import SettingRow from './items/SettingRow'
import DataSection from './DataSection'
import type { Category } from './settingsSearch'
import type { Settings } from './settings'

/** 録音の入力元の行（開いたときに一覧を読む。名前はマイクを許可するまで出ないことがある） */
function InputDeviceRow(p: { value: string; onChange: (v: string) => void; t: (key: MessageKey) => string }) {
  const [inputs, setInputs] = useState<InputDevice[]>([])
  useEffect(() => void listInputDevices().then(setInputs, () => setInputs([])), [])
  return (
    <Row label={p.t('settings.inputDevice')}>
      <Choice<string> value={p.value} onChange={p.onChange} options={[['', p.t('settings.inputDefault')], ...inputs.map((d) => [d.id, d.label] as [string, string])]} />
    </Row>
  )
}

/** 設定画面の分類ごとの中身。定義（items/）のある項目は S('名前') の 1 行で置け、検索の対象にも自動で入る */
export function settingsPages({ draft, set, t, onClose }: { draft: Settings; set: (patch: Partial<Settings>) => void; t: (key: MessageKey) => string; onClose: () => void }): Record<Category, ReactNode> {
  const S = (name: keyof Settings) => <SettingRow name={name} draft={draft} set={set} t={t} />
  // 操作の名前はメニューと同じ（menu.<操作の名前>）
  const keyActions = ACTIONS.map((a) => ({ ...a, label: t(`menu.${a.id}` as MessageKey) }))
  return {
    general: (
      <>
        <Group title={t('settings.groupStartup')}>
          {S('autoRestore')}
          {S('confirmClose')}
        </Group>
        <Group title={t('settings.groupWindows')}>
          {S('maxWindows')}
          {S('extraWindows')}
        </Group>
        <Group title={t('settings.groupOutput')}>
          <OutputDeviceRow value={draft.outputDevice} onChange={(outputDevice) => set({ outputDevice })} t={t} />
          {S('outputLimit')}
          {draft.outputLimit && S('outputLimitDb')}
        </Group>
        <Group title={t('settings.groupRecord')}>
          <InputDeviceRow value={draft.inputDevice} onChange={(inputDevice) => set({ inputDevice })} t={t} />
          {S('recordEchoCancellation')}
          {S('recordNoiseSuppression')}
          {S('recordAutoGain')}
        </Group>
        <Group title={t('settings.groupUpdate')}>
          <UpdateSection />
        </Group>
      </>
    ),
    edit: (
      <>
        <Group title={t('settings.groupHistory')}>{S('historyLimit')}</Group>
        <Group title={t('settings.groupInput')}>
          {S('sliderDoubleClickReset')}
          {S('grid')}
        </Group>
      </>
    ),
    keys: (
      <Group title={t('settings.groupShortcuts')}>
        <KeymapEditor actions={keyActions} overrides={draft.keys} onChange={(keys) => set({ keys })} />
      </Group>
    ),
    file: (
      <Group title={t('settings.groupFile')}>
        {S('rememberFolder')}
        {S('startFolder')}
        {S('recentFiles')}
      </Group>
    ),
    display: (
      <Group title={t('settings.groupAppearance')}>
        {S('theme')}
        {S('uiScale')}
        {S('showMeters')}
        <Row label={t('settings.language')}>
          <Choice<LangSetting> value={draft.language} onChange={(language) => set({ language })} options={[['auto', t('settings.languageAuto')], ...i18n.options()]} />
        </Row>
      </Group>
    ),
    pitch: (
      <Group title={t('settings.cat.pitch')}>
        <Row label={t('settings.algorithm')}>
          <Choice<Algorithm> value={draft.algorithm} onChange={(algorithm) => set({ algorithm })} options={Object.entries(ALGORITHM_NAMES) as [Algorithm, string][]} />
        </Row>
        {S('preserveFormant')}
      </Group>
    ),
    data: (
      <Group title={t('settings.groupData')}>
        <DataSection onClose={onClose} />
      </Group>
    ),
    debug: (
      <Group title={t('settings.groupDebug')}>
        {S('showDebug')}
        {S('devUpdates')}
        {S('filePicker')}
        <Row label={t('settings.dialogWindow')}>
          <Choice<WindowMode | 'auto'>
            value={draft.dialogWindow}
            onChange={(dialogWindow) => set({ dialogWindow })}
            options={[
              ['auto', t('settings.auto')],
              ['dialog', t('settings.windowDialog')],
              ['popup', t('settings.windowPopup')],
              ['tab', t('settings.windowTab')],
              ['window', t('settings.windowSub')],
            ]}
          />
        </Row>
      </Group>
    ),
  }
}
