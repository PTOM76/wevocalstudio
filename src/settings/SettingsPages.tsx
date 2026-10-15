// 設定画面の分類ごとの中身（定義のある項目は S(名前) の 1 行。WeVocalSynth と同じ形）
import { useEffect, useState, type ReactNode } from 'react'
import { Box, Button, Typography } from '@mui/material'
import { listInputDevices, visibleAlgorithms, type Algorithm, type InputDevice } from 'wevocal-lib'
import { AddonSection, Check, Choice, Group, KeymapEditor, Row, pevenFont, type WindowMode } from 'pevenmui'
import { EXTRACT_MODELS, isMdxModel, resolveModel, type VocalModel } from 'wevocalextractor/host'
import { backendAllowed } from 'wevocalextractor/compat'
import { ADDONS } from '../addons'
import { UpdateSection } from 'pevenmui/pwa'
import { OutputDeviceRow } from 'wevocal-lib/react'
import { i18n, type LangSetting, type MessageKey } from '../i18n'
import { ACTIONS } from '../keymap'
import SettingRow from './items/SettingRow'
import DataSection from './DataSection'
import type { Category } from './settingsSearch'
import type { Settings } from './settings'

/** 抽出のモデルの呼び名（WeVocalSynth と同じ） */
const MODEL_LABELS: Record<VocalModel, MessageKey> = { fp16: 'addon.modelLight', int8: 'addon.modelStandard', fp32: 'addon.modelPrecise', 'voc-ft': 'addon.modelVocalHq', 'inst-hq4': 'addon.modelInstHq', kara2: 'addon.modelLead' }

/** 設定の「ボーカル抽出」に並べる追加機能（モデル。実行環境はモデルと一緒に導入・削除するので別に出す） */
const VOCAL_ADDONS = ADDONS.filter((a) => a.requires?.includes('vocal-extractor') && !a.companion).map((a) => a.id)

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
export function settingsPages({ draft, set, t, onClose, go }: { draft: Settings; set: (patch: Partial<Settings>) => void; t: (key: MessageKey, vars?: Record<string, string | number>) => string; onClose: () => void; go: (category: Category) => void }): Record<Category, ReactNode> {
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
        {S('editBar')}
        <Row label={t('settings.language')}>
          <Choice<LangSetting> value={draft.language} onChange={(language) => set({ language })} options={[['auto', t('settings.languageAuto')], ...i18n.options()]} />
        </Row>
      </Group>
    ),
    process: (
      <Group title={t('settings.groupDefaultAlgorithm')}>
        <Row label={t('settings.algorithm')}>
          <Choice<Algorithm> value={draft.algorithm} onChange={(algorithm) => set({ algorithm })} options={visibleAlgorithms(draft.showLegacyAlgorithms, [draft.algorithm]).map((a): [Algorithm, string] => [a.value, t(a.label)])} />
        </Row>
        {S('showLegacyAlgorithms')}
        {S('preserveFormant')}
      </Group>
    ),
    vocal: (
      <>
        <Group title={t('settings.groupVocal')}>
          {/* この端末で使えないモデルは、抽出のときに代わりのモデルを使うことを知らせる（WeVocalSynth と同じ） */}
          <Row
            label={t('settings.vocalModel')}
            help={
              resolveModel(draft.vocalModel, draft.vocalGpu).replaced
                ? t('settings.vocalModelReplaced', { from: t(MODEL_LABELS[draft.vocalModel]), name: t(MODEL_LABELS[resolveModel(draft.vocalModel, draft.vocalGpu).model]) })
                : isMdxModel(draft.vocalModel) && (!draft.vocalGpu || !('gpu' in navigator))
                  ? t('settings.vocalSlowCpu')
                  : undefined
            }
          >
            <Choice<VocalModel> value={draft.vocalModel} onChange={(vocalModel) => set({ vocalModel })} options={EXTRACT_MODELS.map((m): [VocalModel, string] => [m, t(MODEL_LABELS[m])])} />
          </Row>
          {/* GPU を使えないモデルでは押せなくし、理由を出す */}
          <Check
            checked={draft.vocalGpu && backendAllowed(draft.vocalModel, 'webgpu')}
            disabled={!backendAllowed(draft.vocalModel, 'webgpu')}
            onChange={(vocalGpu) => set({ vocalGpu })}
            label={t('settings.vocalGpu')}
            help={backendAllowed(draft.vocalModel, 'webgpu') ? t('settings.vocalGpuHelp') : t('settings.vocalGpuUnsupported')}
          />
          {S('vocalKeepHighBand')}
          {S('vocalBeforeAnalysis')}
        </Group>
        <Group title={t('settings.groupStems')}>
          {S('stemModel')}
          {S('stemChorus')}
        </Group>
        <Group title={t('settings.groupAddons')}>
          {/* 追加機能の一覧（AddonSection）と同じく、説明は左、ボタンは右（WeVocalSynth と同じ） */}
          <Box sx={{ gridColumn: '1 / -1', width: '100cqi', maxWidth: '100cqi', display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography sx={{ flex: 1, minWidth: 0, fontSize: pevenFont('base') }}>{t('settings.addonsMoved')}</Typography>
            <Button size="small" variant="outlined" onClick={() => go('addons')} sx={{ flexShrink: 0 }}>
              {t('settings.openAddons')}
            </Button>
          </Box>
        </Group>
      </>
    ),
    addons: (
      <>
        <Group title={t('settings.groupAddonVocal')}>
          <AddonSection ids={VOCAL_ADDONS} />
        </Group>
        {/* モデルを入れると一緒に入る実行環境。大きさの確認や、使わなくなった方（GPU 用、CPU 用）の削除のために分けて出す */}
        <Group title={t('settings.groupAddonVocalRuntime')}>
          <AddonSection ids={['vocal-extractor', 'vocal-extractor-gpu', 'vocal-extractor-cpu']} />
        </Group>
        <Group title={t('settings.groupAddonAnalyzer')}>
          <AddonSection ids={['analyzer']} />
        </Group>
        <Group title={t('settings.groupAddonLyrics')}>
          <AddonSection ids={['analyzer-lyrics', 'whisper-tiny', 'whisper-base', 'whisper-small']} />
        </Group>
        <Group title={t('settings.groupAddonConverter')}>
          <AddonSection ids={['converter']} />
        </Group>
      </>
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
        {S('showVoiceSplit')}
        {S('showDevPlugins')}
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
