// キーの割り当ての表。操作の名前 → キー。キーを変えるときはここだけ直す（あとで設定から変えられるようにする）

/** 操作の名前 */
export type Action =
  | 'playStop'
  | 'stop'
  | 'pause'
  | 'repeat'
  | 'toStart'
  | 'toEnd'
  | 'zoomIn'
  | 'zoomOut'
  | 'split'
  | 'splitRange'
  | 'clearRange'
  | 'delete'
  | 'undo'
  | 'redo'
  | 'copy'
  | 'paste'
  | 'duplicate'
  | 'properties'
  | 'open'
  | 'save'
  | 'import'
  | 'export'
  | 'pitchUp'
  | 'pitchDown'
  | 'pitchUpFine'
  | 'pitchDownFine'
  | 'pitchReset'

/**
 * キーの書き方は `Ctrl+Shift+キー`（キーは KeyboardEvent の code）。1 つの操作に複数のキーを割り当てられる。
 * できるだけ REAPER の既定の割り当てに合わせる（2026-10-09 に調べたもの。資料によって違うものは両方入れる）
 */
export const KEYMAP: Record<Action, string[]> = {
  playStop: ['Space'],
  // 停止は再生を始めた位置に戻る。一時停止はその場で止まる（REAPER と同じ）
  stop: [],
  pause: ['Ctrl+Space'],
  repeat: ['KeyR'],
  toStart: ['Home'],
  toEnd: ['End'],
  zoomIn: ['NumpadAdd', 'Equal'],
  zoomOut: ['NumpadSubtract', 'Minus'],
  split: ['KeyS'],
  splitRange: ['Shift+KeyS'],
  clearRange: ['Escape'],
  delete: ['Delete'],
  undo: ['Ctrl+KeyZ'],
  redo: ['Ctrl+Shift+KeyZ', 'Ctrl+KeyY'],
  copy: ['Ctrl+KeyC'],
  paste: ['Ctrl+KeyV'],
  duplicate: ['Ctrl+KeyD'],
  // 波形ブロックのプロパティ（REAPER のアイテムのプロパティ）
  properties: ['F2', 'Shift+F2'],
  open: ['Ctrl+KeyO'],
  save: ['Ctrl+KeyS'],
  import: ['Insert'],
  // REAPER の「書き出し（Render）」と同じ
  export: ['Ctrl+Alt+KeyR'],
  // ピッチ: テンキーの 9 と 3 で 1 半音、Shift を足すと 10 セント。Ctrl+↑↓ でも変えられる。Ctrl+Backspace か Ctrl+0 で元に戻す
  pitchUp: ['Numpad9', 'Ctrl+ArrowUp'],
  pitchDown: ['Numpad3', 'Ctrl+ArrowDown'],
  pitchUpFine: ['Shift+Numpad9', 'Ctrl+Shift+ArrowUp'],
  pitchDownFine: ['Shift+Numpad3', 'Ctrl+Shift+ArrowDown'],
  pitchReset: ['Ctrl+Backspace', 'Ctrl+Digit0', 'Ctrl+Numpad0'],
}

/** 押されたキーを表の書き方にする */
function comboOf(e: KeyboardEvent) {
  return [e.ctrlKey || e.metaKey ? 'Ctrl' : '', e.altKey ? 'Alt' : '', e.shiftKey ? 'Shift' : '', e.code].filter(Boolean).join('+')
}

/** 押されたキーに割り当てた操作。なければ null */
export function actionOf(e: KeyboardEvent): Action | null {
  const combo = comboOf(e)
  return (Object.keys(KEYMAP) as Action[]).find((a) => KEYMAP[a].includes(combo)) ?? null
}

/** メニューに出すキーの表記（最初の割り当て） */
export const keyLabel = (a: Action) =>
  (KEYMAP[a][0] ?? '').replace('Numpad', 'Num ').replace('Add', '+').replace('Subtract', '-').replace('Key', '').replace('Digit', '').replace('Equal', '=').replace('Minus', '-')
