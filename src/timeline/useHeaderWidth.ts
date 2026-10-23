// 時間軸の左のトラックの欄の幅と、開閉。幅は境目の分割バーで変えられて、次回も引き継ぐ
import { useState } from 'react'
import { useMobileLayout, usePanelWidth } from 'pevenmui'

/** トラック一覧の幅（境目の分割バーで変えられる。幅は次回も引き継ぐ） */
export const useHeaderWidth = () => {
  const mobile = useMobileLayout()
  const panel = usePanelWidth('studio.headerWidth', mobile ? 136 : 200, 120, 480, 'left')
  // 欄を閉じて、時間軸を広く使える（閉じたかどうかは次回も引き継ぐ。まだ選んでいないときは、スマホの縦持ちなら閉じる）
  const [collapsed, setCollapsed] = useState(() => {
    try {
      const saved = localStorage.getItem(COLLAPSED_KEY)
      if (saved !== null) return saved === '1'
    } catch {
      // 読めなければ、画面の向きで決める
    }
    return mobile && !!window.matchMedia?.('(orientation: portrait)').matches
  })
  const toggle = () => {
    try {
      localStorage.setItem(COLLAPSED_KEY, collapsed ? '0' : '1')
    } catch {
      // 保存できなくても、このセッション中は使う
    }
    setCollapsed(!collapsed)
  }
  return { width: collapsed ? COLLAPSED_WIDTH : panel.width, bar: collapsed ? null : panel.bar, collapsed, toggle }
}
const COLLAPSED_KEY = 'studio.headerCollapsed'
/** 閉じたときの欄の幅（開くボタンだけ） */
const COLLAPSED_WIDTH = 32
