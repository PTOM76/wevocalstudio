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
  // 同時に開くウィンドウの数（ウィンドウごとに自動保存を分ける。PevenMUI の windowSlot）と、上限を超えても開くか（そのウィンドウは自動保存しない）
  maxWindows: number(4, { label: 'settings.maxWindows', min: 1, max: 8, step: 1 }),
  extraWindows: check(false, { label: 'settings.extraWindows', help: 'settings.extraWindowsHelp' }),
  // 音声の出力先（'' は既定。設定画面は wevocal-lib の行）と、鳴らす音の上限（耳とスピーカーを守る）
  outputDevice: value(''),
  outputLimit: check(true, { label: 'settings.outputLimit', help: 'settings.outputLimitHelp' }),
  // 再生位置の表示の補正（ms。音が出口に着く遅れの分を、表示から引く。iPad など、位置だけ先に進んで見えるときに増やす）
  playbackOffsetMs: number(0, { label: 'settings.playbackOffsetMs', help: 'settings.playbackOffsetMsHelp', min: -300, max: 500, step: 10, unit: 'ms' }),
  outputLimitDb: number(-1, { label: 'settings.outputLimitDb', min: -24, max: 0, step: 1, unit: 'dB' }),
  // 録音の入力元（'' は既定の入力。設定画面は自前の行）と、ブラウザの音声処理（原音のまま録るので既定はオフ）
  inputDevice: value(''),
  recordEchoCancellation: check(false, { label: 'settings.recordEcho' }),
  recordNoiseSuppression: check(false, { label: 'settings.recordNoise' }),
  recordAutoGain: check(false, { label: 'settings.recordAutoGain', help: 'settings.recordHelp' }),
  // MIDI キーボードをつなぐ（弾いた音を、音源のあるトラックで鳴らす。録音待機のトラックでは MIDI ブロックに録る）。Chrome、Edge のみ
  midiInput: check(false, { label: 'settings.midiInput', help: 'settings.midiInputHelp' }),
  // 受けるチャンネル（0 はすべて）、サステインペダル（CC64）、録音の遅れの補正（ms。入力が遅れて届く分を、録る位置から引く）、録り方
  midiChannel: number(0, { label: 'settings.midiChannel', help: 'settings.midiChannelHelp', min: 0, max: 16, step: 1 }),
  midiSustain: check(true, { label: 'settings.midiSustain' }),
  midiLatencyMs: number(0, { label: 'settings.midiLatencyMs', help: 'settings.midiLatencyMsHelp', min: 0, max: 300, step: 5, unit: 'ms' }),
  midiRecordMode: choice<'new' | 'overlay'>('new', {
    label: 'settings.midiRecordMode',
    options: [
      ['new', 'settings.midiRecordNew'],
      ['overlay', 'settings.midiRecordOverlay'],
    ],
  }),
})

/** 「編集」 */
export const edit = defineItems('edit', {
  // 元に戻せる回数（波形ブロックは元の音を指すだけなので、Synth より多くても軽い）
  historyLimit: number(200, { label: 'settings.historyLimit', min: 1, max: 1000, step: 1 }),
  // スライダー（音量、パン）をダブルクリックで既定の値に戻す
  sliderDoubleClickReset: check(true, { label: 'settings.sliderReset' }),
  // 新しい波形ブロックと分割点に付けるフェード
  defaultBlockFade: check(true, { label: 'settings.defaultBlockFade' }),
  defaultBlockFadeMs: number(10, { label: 'settings.defaultBlockFadeMs', min: 1, max: 500, step: 1, unit: 'ms' }),
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
