// ドック（画面の端の欄に、ダイアログを置けるようにする PevenMUI の DockProvider）に、アプリの訳文を渡す
import { useMemo, type ReactNode } from 'react'
import { DockProvider } from 'pevenmui'
import { useT } from './i18n'

export default function AppDock({ windowSnap, children }: { /** 別の窓を端に寄せて離したら置くか */ windowSnap: boolean; children: ReactNode }) {
  const t = useT()
  const labels = useMemo(
    () => ({ dock: t('dock.dock'), undock: t('dock.undock'), close: t('common.close'), edges: { bottom: t('dock.edgeBottom'), left: t('dock.edgeLeft'), right: t('dock.edgeRight'), top: t('dock.edgeTop') } }),
    [t],
  )
  return (
    <DockProvider labels={labels} windowSnap={windowSnap}>
      {children}
    </DockProvider>
  )
}
