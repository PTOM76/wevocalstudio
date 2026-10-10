// キーの割り当て。既定の表（操作の名前 → キー）と、設定の「キーとマウス」で変えた分（PevenMUI の keymap と同じ形）
import { comboOf, resolveKeymap, type KeymapOverrides } from 'pevenmui'

/** 操作の名前 */
export type Action =
  | 'playStop'
  | 'stop'
  | 'pause'
  | 'repeat'
  | 'record'
  | 'toStart'
  | 'cursorLeft'
  | 'cursorRight'
  | 'nudgeLeft'
  | 'nudgeRight'
  | 'newProject'
  | 'toEnd'
  | 'snap'
  | 'follow'
  | 'envelope'
  | 'zoomIn'
  | 'zoomOut'
  | 'detectTempo'
  | 'addMarker'
  | 'nextMarker'
  | 'prevMarker'
  | 'split'
  | 'splitRange'
  | 'splitSilence'
  | 'clearRange'
  | 'delete'
  | 'undo'
  | 'redo'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'duplicate'
  | 'selectAll'
  | 'properties'
  | 'open'
  | 'save'
  | 'saveAs'
  | 'import'
  | 'export'
  | 'pitchUp'
  | 'pitchDown'
  | 'pitchUpFine'
  | 'pitchDownFine'
  | 'pitchReset'

/**
 * キーの書き方は `Ctrl+Shift+キー`（キーは KeyboardEvent の code）。1 つの操作に複数のキーを割り当てられる。
 * DAW でよく使われる割り当てに合わせる（違う割り当てがよく使われるものは両方入れる）
 */
export const DEFAULT_KEYS: Record<Action, string[]> = {
  playStop: ['Space'],
  // 停止は再生を始めた位置に戻る。一時停止はその場で止まる
  stop: [],
  pause: ['Ctrl+Space'],
  repeat: ['KeyR'],
  // 録音（Ctrl+R）
  record: ['Ctrl+KeyR'],
  toStart: ['Home'],
  // 再生位置を 1 拍（線の 1 目盛り）ずつ動かす
  cursorLeft: ['ArrowLeft'],
  cursorRight: ['ArrowRight'],
  // 選んだ波形ブロックを 1 拍ずつ動かす（テンキーの 4 と 6）
  nudgeLeft: ['Numpad4'],
  nudgeRight: ['Numpad6'],
  newProject: ['Ctrl+KeyN'],
  toEnd: ['End'],
  // スナップの切り替え
  snap: ['Alt+KeyS'],
  // 再生位置に表示を追従させるか
  follow: ['KeyF'],
  // 音量のエンベロープを出して編集する
  envelope: ['KeyE'],
  zoomIn: ['NumpadAdd', 'Equal'],
  zoomOut: ['NumpadSubtract', 'Minus'],
  // マーカー（M で足す）
  addMarker: ['KeyM'],
  detectTempo: [],
  nextMarker: ['BracketRight'],
  prevMarker: ['BracketLeft'],
  split: ['KeyS'],
  splitRange: ['Shift+KeyS'],
  splitSilence: [],
  clearRange: ['Escape'],
  delete: ['Delete'],
  undo: ['Ctrl+KeyZ'],
  redo: ['Ctrl+Shift+KeyZ', 'Ctrl+KeyY'],
  cut: ['Ctrl+KeyX'],
  copy: ['Ctrl+KeyC'],
  paste: ['Ctrl+KeyV'],
  duplicate: ['Ctrl+KeyD'],
  selectAll: ['Ctrl+KeyA'],
  // 波形ブロックのプロパティ
  properties: ['F2', 'Shift+F2'],
  open: ['Ctrl+KeyO'],
  save: ['Ctrl+KeyS'],
  saveAs: ['Ctrl+Shift+KeyS'],
  import: ['Insert'],
  // 書き出し
  export: ['Ctrl+Alt+KeyR'],
  // ピッチ:  Shift+0（US 配列の「)」）で 1 半音上げ、Shift+9（「(」）で下げる。テンキーの 9 と 3、Ctrl+↑↓ でも変えられる。
  // テンキーで Shift を足すと 10 セント。Ctrl+Backspace か Ctrl+0 で元に戻す
  pitchUp: ['Shift+Digit0', 'Numpad9', 'Ctrl+ArrowUp'],
  pitchDown: ['Shift+Digit9', 'Numpad3', 'Ctrl+ArrowDown'],
  pitchUpFine: ['Shift+Numpad9', 'Ctrl+Shift+ArrowUp'],
  pitchDownFine: ['Shift+Numpad3', 'Ctrl+Shift+ArrowDown'],
  pitchReset: ['Ctrl+Backspace', 'Ctrl+Digit0', 'Ctrl+Numpad0'],
}

/** 操作の一覧（並びは設定の画面の並び） */
export const ACTIONS = (Object.keys(DEFAULT_KEYS) as Action[]).map((id) => ({ id, keys: DEFAULT_KEYS[id] }))

/** 今の割り当て（設定で変えたものはそれ、ほかは既定）。App が設定から入れる */
let keymap: Record<Action, string[]> = DEFAULT_KEYS
export function setKeyOverrides(o: KeymapOverrides<Action>) {
  keymap = resolveKeymap(ACTIONS, o)
}
export const currentKeys = (a: Action) => keymap[a]
/** 今の割り当て全部（ショートカットの一覧） */
export const currentKeymap = () => keymap

/** 押されたキーに割り当てた操作。なければ null */
export function actionOf(e: KeyboardEvent): Action | null {
  const combo = comboOf(e)
  if (!combo) return null
  return (Object.keys(keymap) as Action[]).find((a) => keymap[a].includes(combo)) ?? null
}

/** キーの表記（テンキーは Num を付けて区別する） */
export const comboText = (combo: string) =>
  combo.replace('Numpad', 'Num ').replace('Add', '+').replace('Subtract', '-').replace('Key', '').replace('Digit', '').replace('Equal', '=').replace('Minus', '-').replace('Arrow', '')

/** メニューに出すキーの表記（最初の割り当て。なければ空） */
export const keyLabel = (a: Action) => (keymap[a][0] ? comboText(keymap[a][0]) : '')
