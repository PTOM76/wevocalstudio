// タッチの端末では、最初に波形ブロックを置いたときに、長押しとダブルタップの操作を一度だけ知らせる（見つけにくいため）
import { useEffect } from 'react'
import type { useT } from './i18n'

/** 案内を出したか（一度だけ） */
const TOUCH_HINT_KEY = 'studio.touchHint'

export function useTouchHint(touchLike: boolean, hasBlocks: boolean, t: ReturnType<typeof useT>, notify: (message: string) => void) {
  useEffect(() => {
    if (!touchLike || !hasBlocks) return
    try {
      if (localStorage.getItem(TOUCH_HINT_KEY)) return
      localStorage.setItem(TOUCH_HINT_KEY, '1')
    } catch {
      return
    }
    notify(t('hint.touch'))
  }, [touchLike, hasBlocks, t, notify])
}
