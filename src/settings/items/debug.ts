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
