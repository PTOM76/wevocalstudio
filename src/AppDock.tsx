// ドック（画面の下の欄に、ダイアログを置けるようにする PevenMUI の DockProvider）に、アプリの訳文を渡す
import type { ReactNode } from 'react'
import { DockProvider } from 'pevenmui'
import { useT } from './i18n'

export default function AppDock({ children }: { children: ReactNode }) {
  const t = useT()
  return <DockProvider labels={{ dock: t('dock.dock'), undock: t('dock.undock'), close: t('common.close') }}>{children}</DockProvider>
}
