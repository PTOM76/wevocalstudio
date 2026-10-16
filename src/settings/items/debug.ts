// 「開発者向け」の項目（名前と既定値は WeVocalSynth と同じ。devUpdates だけ開発中なので既定でオン）
import type { WindowMode } from 'pevenmui'
import type { PickerMode } from 'pevenmui/web'
import { check, choice, defineItems, value } from './define'

/** 「開発者向け」 */
export const debug = defineItems('debug', {
  // デバッグ表示（FPS、描画回数、メモリ、AudioContext の状態。PevenMUI の DebugOverlay）
  showDebug: check(false, { label: 'settings.showDebug', help: 'settings.showDebugHelp' }),
  // 版の番号が同じでも、新しいコミットがあれば更新を知らせる
  devUpdates: check(true, { label: 'settings.devUpdates', help: 'settings.devUpdatesHelp' }),
  // 試験的機能の和音の分離をメニューに出す（WeVocalSynth と同じ）
  showVoiceSplit: check(false, { label: 'settings.showVoiceSplit', help: 'settings.showVoiceSplitHelp' }),
  // 試験的機能の VST（Windows の DLL をエミュレーターで動かす。書き出しのときだけ掛かる）を、設定のプラグインから導入できるようにする
  showVst: check(false, { label: 'settings.showVst', help: 'settings.showVstHelp' }),
  // 開発者向けのプラグイン（雛形）を FX の追加の一覧に出す
  showDevPlugins: check(false, { label: 'settings.showDevPlugins', help: 'settings.showDevPluginsHelp' }),
  filePicker: choice<PickerMode>('auto', {
    label: 'settings.filePicker',
    help: 'settings.filePickerHelp',
    options: [
      ['auto', 'settings.filePickerAuto'],
      ['api', 'settings.filePickerApi'],
      ['input', 'settings.filePickerInput'],
    ],
  }),
  // ダイアログの出し方（auto は PC なら別ウィンドウ）
  dialogWindow: value<WindowMode | 'auto'>('auto', { label: 'settings.dialogWindow' }),
})
