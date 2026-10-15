// ダイアログの開閉と、開くときに渡す値（PevenMUI の useDialogs。WeVocalSynth と同じ）
import { useDialogs as usePevenDialogs, type Dialogs as PevenDialogs } from 'pevenmui'

/** App が開くダイアログ。足すときはここに名前を足し、AppDialogs.tsx に描画を置く */
export type DialogId =
  | 'settings' | 'about' | 'licenses' | 'export' | 'history' | 'shortcuts'
  // 値を渡して開くもの: 波形ブロックのプロパティ（id の一覧）、マーカー（id）、トラックの FX の列（トラックの id か 'master'）
  | 'block' | 'marker' | 'markerTempo' | 'fx'
  // 音を 0 から作る、選んだ波形ブロックを MIDI の音符に並べる（波形ブロックの id）
  | 'synth' | 'sampler'
  // トラックの名前の変更（トラックの id）
  | 'renameTrack'
  // 動画の書き出し（プレビューに使う音）
  | 'video'
  // 一音ずつ切り出す（波形ブロックの id）
  | 'kanaCut'

export const useDialogs = () => usePevenDialogs<DialogId>()
export type Dialogs = PevenDialogs<DialogId>
