// 「全般」「編集」「キーとマウス」「ファイル」の項目（名前と既定値は WeVocalSynth と同じ）
import type { KeymapOverrides } from 'pevenmui'
import type { StartFolder } from 'pevenmui/web'
import type { Action } from '../../keymap'
import { check, choice, defineItems, number, value } from './define'

/** 「全般」 */
export const general = defineItems('general', {
  // 作業を自動保存し、次に開いたときに戻す
  autoRestore: check(true, { label: 'settings.autoRestore', help: 'settings.autoRestoreHelp' }),
  // 保存していない変更があれば、閉じる前に確かめる（自動保存がオフのとき）
  confirmClose: check(true, { label: 'settings.confirmClose', help: 'settings.confirmCloseHelp' }),
  // 音声の出力先（'' は既定。設定画面は wevocal-lib の行）と、鳴らす音の上限（耳とスピーカーを守る）
  outputDevice: value(''),
  outputLimit: check(true, { label: 'settings.outputLimit', help: 'settings.outputLimitHelp' }),
  outputLimitDb: number(-1, { label: 'settings.outputLimitDb', min: -24, max: 0, step: 1, unit: 'dB' }),
  // 録音の入力元（'' は既定の入力。設定画面は自前の行）と、ブラウザの音声処理（原音のまま録るので既定はオフ）
  inputDevice: value(''),
  recordEchoCancellation: check(false, { label: 'settings.recordEcho' }),
  recordNoiseSuppression: check(false, { label: 'settings.recordNoise' }),
  recordAutoGain: check(false, { label: 'settings.recordAutoGain', help: 'settings.recordHelp' }),
})

/** 「編集」 */
export const edit = defineItems('edit', {
  // 元に戻せる回数（波形ブロックは元の音を指すだけなので、Synth より多くても軽い）
  historyLimit: number(200, { label: 'settings.historyLimit', min: 1, max: 1000, step: 1 }),
  // スライダー（音量、パン）をダブルクリックで既定の値に戻す
  sliderDoubleClickReset: check(true, { label: 'settings.sliderReset' }),
})

/** 「キーとマウス」 */
export const keys = defineItems('keys', {
  // 既定から変えたキーの割り当て（keymap.ts）
  keys: value<KeymapOverrides<Action>>({}),
})

/** 「ファイル」 */
export const file = defineItems('file', {
  // 開くフォルダーと保存するフォルダーを用途ごとに覚える（Chrome、Edge。PevenMUI の fileAccess）
  rememberFolder: check(true, { label: 'settings.rememberFolder', help: 'settings.rememberFolderHelp' }),
  startFolder: choice<StartFolder>('downloads', {
    label: 'settings.startFolder',
    options: [
      ['downloads', 'settings.folderDownloads'],
      ['documents', 'settings.folderDocuments'],
      ['desktop', 'settings.folderDesktop'],
      ['music', 'settings.folderMusic'],
    ],
  }),
  recentFiles: check(true, { label: 'settings.recentFiles', help: 'settings.recentFilesHelp' }),
})
