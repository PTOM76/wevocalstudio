// 「表示」の項目と、表示メニューとツールバーで切り替えるもの（名前と既定値は WeVocalSynth と同じ）
import type { LangSetting } from '../../i18n'
import type { EditBarSetting, Preset } from 'pevenmui'
import { DEFAULT_VIDEO_PREFS, type VideoExportPrefs } from 'wevocalconverter/host'
import type { BlockPreset } from '../../BlockDialog'
import { check, choice, defineItems, value } from './define'

export type ThemeSetting = 'system' | 'light' | 'dark'

/** 「表示」 */
export const display = defineItems('display', {
  theme: choice<ThemeSetting>('system', {
    label: 'settings.theme',
    options: [
      ['system', 'settings.themeSystem'],
      ['light', 'settings.themeLight'],
      ['dark', 'settings.themeDark'],
    ],
  }),
  uiScale: choice<number>(1, { label: 'settings.uiScale', help: 'settings.uiScaleHelp', values: [0.9, 1, 1.1, 1.25], format: (s) => `${Math.round(s * 100)}%` }),
  // 波形ブロックか範囲を選んだときの編集のボタンの列（auto はスマホとタブレットだけ）
  editBar: choice<EditBarSetting>('auto', {
    label: 'settings.editBar',
    options: [
      ['auto', 'settings.editBarAuto'],
      ['on', 'settings.editBarOn'],
      ['off', 'settings.editBarOff'],
    ],
  }),
  showMeters: check(true, { label: 'settings.showMeters', help: 'settings.showMetersHelp' }),
  language: value<LangSetting>('auto', { label: 'settings.language' }),
})

/** 表示メニューとツールバーで切り替えるもの（設定画面には出さない） */
export const view = defineItems(null, {
  showStatusBar: value(true, { label: 'menu.statusBar' }),
  showMinimap: value(true, { label: 'menu.minimap' }),
  // 解析の欄（WeVocalAnalyzer のスペクトログラムと F0）
  showAnalysis: value(false, { label: 'menu.analysis' }),
  // ドラッグを目盛りの線や波形ブロックの端に吸い付ける
  snap: value(true, { label: 'menu.snap' }),
  // 再生中に表示を再生位置に追従させる
  follow: value(true, { label: 'menu.follow' }),
  // 音量のエンベロープを出して編集する
  envelope: value(false, { label: 'menu.envelope' }),
  // ピッチのエンベロープを出して編集する（音量のエンベロープとはどちらか一方）
  pitchEnvelope: value(false, { label: 'menu.pitchEnvelope' }),
})

/** 画面の操作で覚えておく値（設定画面には出さない。WeVocalSynth の stored と同じ） */
export const stored = defineItems(null, {
  // 書き出しの仕上げ（ノーマライズ、両端のフェード）
  exportNormalize: value(false),
  exportFadeMs: value(0),
  // 動画の書き出しで選んだもの（背景の画像は覚えない。converter の既定値）
  exportVideo: value<VideoExportPrefs>(DEFAULT_VIDEO_PREFS),
  // 波形ブロックのプロパティのプリセット（音の作り方）
  presets: value<Preset<BlockPreset>[]>([]),
  // FX のプリセット（プラグインの id ごと）
  fxPresets: value<Record<string, Preset<Record<string, number>>[]>>({}),
})
