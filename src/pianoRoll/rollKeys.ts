// 別の窓のピアノロールで、Ctrl+Z と Ctrl+Y（Ctrl+Shift+Z）で戻す、やり直す。同じ窓ではメインのキーが受けるので、何もしない
import type { KeyboardEvent } from 'react'

/** 受けたら true（呼び出し側は、ほかのキーの処理に回さない） */
export function undoRedoKey(e: KeyboardEvent, onUndo: () => void, onRedo: () => void): boolean {
  if (e.currentTarget.ownerDocument === document || !(e.ctrlKey || e.metaKey)) return false
  const key = e.key.toLowerCase()
  if (key !== 'z' && key !== 'y') return false
  e.preventDefault()
  if (key === 'y' || e.shiftKey) onRedo()
  else onUndo()
  return true
}
