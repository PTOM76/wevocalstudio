// キーの割り当ての表。操作の名前 → キー。キーを変えるときはここだけ直す（あとで設定から変えられるようにする）

/** 操作の名前 */
export type Action = 'playStop' | 'split' | 'delete' | 'pitchUp' | 'pitchDown' | 'pitchUpFine' | 'pitchDownFine' | 'pitchReset'

/**
 * キーの書き方は `Ctrl+Shift+キー`（キーは KeyboardEvent の code）。1 つの操作に複数のキーを割り当てられる。
 * ピッチは REAPER と同じく、テンキーの + と - で 1 半音、Shift を足すと 10 セント（0.1 半音）。Ctrl+0 で元のピッチに戻す
 */
export const KEYMAP: Record<Action, string[]> = {
  playStop: ['Space'],
  split: ['KeyS'],
  delete: ['Delete'],
  pitchUp: ['NumpadAdd', 'Ctrl+ArrowUp'],
  pitchDown: ['NumpadSubtract', 'Ctrl+ArrowDown'],
  pitchUpFine: ['Shift+NumpadAdd', 'Ctrl+Shift+ArrowUp'],
  pitchDownFine: ['Shift+NumpadSubtract', 'Ctrl+Shift+ArrowDown'],
  pitchReset: ['Ctrl+Digit0', 'Ctrl+Numpad0'],
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
export const keyLabel = (a: Action) => KEYMAP[a][0].replace('Numpad', 'Num ').replace('Add', '+').replace('Subtract', '-').replace('Key', '').replace('Digit', '')
