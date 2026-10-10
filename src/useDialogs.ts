// ダイアログの開閉と、開くときに渡す値（PevenMUI の useDialogs。WeVocalSynth と同じ）
import { useDialogs as usePevenDialogs, type Dialogs as PevenDialogs } from 'pevenmui'

/** App が開くダイアログ。足すときはここに名前を足し、AppDialogs.tsx に描画を置く */
export type DialogId =
  | 'settings' | 'about' | 'licenses' | 'export' | 'history' | 'shortcuts'
  // 値を渡して開くもの: 波形ブロックのプロパティ（id の一覧）、マーカー（id）、トラックの EQ（id）
  | 'block' | 'marker' | 'eq'

export const useDialogs = () => usePevenDialogs<DialogId>()
export type Dialogs = PevenDialogs<DialogId>
