// 「開発者向け」「音声」「試験的機能」の項目（名前と既定値は WeVocalSynth と同じ。devUpdates だけ開発中なので既定でオン）
import type { WindowMode } from 'pevenmui'
import type { PickerMode } from 'pevenmui/web'
import { check, choice, defineItems, number, value } from './define'

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

/** 「開発者向け」→「音声」 */
export const debugAudio = defineItems('debugAudio', {
  // フォルマント補正で速い対数と指数の近似を使う（切ると標準の関数。聴き比べ用。WeVocalSynth と同じ）
  fastMath: check(true, { label: 'settings.fastMath', help: 'settings.fastMathHelp' }),
  // 止めている間は AudioContext を一時停止する（iOS で音が出ないときの切り分け用。WeVocalSynth と同じ）
  suspendWhenStopped: check(true, { label: 'settings.suspendWhenStopped', help: 'settings.suspendWhenStoppedHelp' }),
  // iOS のオーディオセッションを再生用にする（消音スイッチでも鳴る）
  playbackSession: check(true, { label: 'settings.playbackSession', help: 'settings.playbackSessionHelp' }),
})

/** 「開発者向け」→「試験的機能」 */
export const experimental = defineItems('experimental', {
  // 試験的な処理方式（SMS）を選択肢に表示する（WeVocalSynth と同じ）
  showExperimentalAlgorithms: check(false, { label: 'settings.showExperimentalAlgorithms', help: 'settings.showExperimentalAlgorithmsHelp' }),
  // 試験的機能の和音の分離をメニューに出す（WeVocalSynth と同じ）
  showVoiceSplit: check(false, { label: 'settings.showVoiceSplit', help: 'settings.showVoiceSplitHelp' }),
  // 試験的機能の VST（Windows の DLL をエミュレーターで動かす。書き出しのときだけ掛かる）を、設定のプラグインから導入できるようにする
  showVst: check(false, { label: 'settings.showVst', help: 'settings.showVstHelp' }),
  // 重いプラグイン（VST など）を、再生中に自動で素通しにする（WeVocalSynth と同じ。オフなら途切れても掛け続ける。止まったときと出力が壊れたときは常に素通し）
  autoBypass: check(true, { label: 'settings.autoBypass', help: 'settings.autoBypassHelp' }),
  // 「重いプラグインを先に計算して鳴らす」の進み具合（止めている間の準備、再生中の先読みの量）を状態バーのゲージに出す
  showAnticipateGauge: check(false, { label: 'settings.showAnticipateGauge', help: 'settings.showAnticipateGaugeHelp' }),
  // 開発者向けのプラグイン（雛形）を FX の追加の一覧に出す
  showDevPlugins: check(false, { label: 'settings.showDevPlugins', help: 'settings.showDevPluginsHelp' }),
  // 追加機能を、選んだフォルダーに保存する（試験的。Chrome、Edge。WeVocalSynth と同じ）。フォルダーは AddonFolderRow で選ぶ
  addonFolder: check(false, { label: 'settings.addonFolder', help: 'settings.addonFolderHelp' }),
  // 重いプラグインを持つトラックの音を、再生位置より先に作って鳴らす（試験的。音を出すスレッドの負担が減り、音が途切れにくい。再生を始めるまで少し待つ）
  anticipativeFx: check(false, { label: 'settings.anticipativeFx', help: 'settings.anticipativeFxHelp' }),
  // 先に計算するトラックのうち、FX が外から足した wevocal の processor だけのものは、同じプラグインを途切れずに再生位置の少し先で動かし続ける（試験的。memo/anticipate-stream.md）
  anticipateStream: check(false, { label: 'settings.anticipateStream', help: 'settings.anticipateStreamHelp' }),
  // 止めている間も、カーソルから先の音を作っておく（オフなら再生中だけ。CPU を使うので、電池を気にするとき用）
  anticipateWhileStopped: check(true, { label: 'settings.anticipateWhileStopped', help: 'settings.anticipateWhileStoppedHelp' }),
  // 先に計算した音を、再生をまたいで取っておく量（MB。0 で取っておかない。memo/fx-cache.md）
  anticipativeCacheMb: number(256, { label: 'settings.anticipativeCacheMb', help: 'settings.anticipativeCacheMbHelp', min: 0, max: 2048, step: 64, unit: 'MB' }),
})
