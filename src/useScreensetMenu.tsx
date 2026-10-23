// 名前を付けた配置（スクリーンセット。PevenMUI の useScreensets）の、表示メニューの項目と名前を入れるダイアログ。呼び出すと、欄に置いていた解析の欄も開き直す
import { useState } from 'react'
import { RenameDialog, useScreensets } from 'pevenmui'
import type { MenuEntry } from 'pevenmui'
import { useT } from './i18n'

export function useScreensetMenu(o: { showAnalysis: (on: boolean) => void }) {
  const t = useT()
  const sets = useScreensets()
  const [naming, setNaming] = useState<string | null>(null)
  const apply = (name: string) => {
    const open = sets.apply(name)
    // 値を渡さずに開けるのは解析の欄だけ。ほかのパネルは、次に開いたときに戻した置き場所に出る
    o.showAnalysis(open.includes('analysis'))
  }
  const menu: MenuEntry = {
    label: t('menu.screensets'),
    onClick: () => {},
    submenu: [
      ...sets.names.map((name): MenuEntry => ({ label: name, onClick: () => apply(name) })),
      ...(sets.names.length ? [{ divider: true } as MenuEntry] : []),
      { label: t('menu.saveScreenset'), onClick: () => setNaming(t('screenset.defaultName', { n: sets.names.length + 1 })) },
      { label: t('menu.deleteScreenset'), disabled: !sets.names.length, onClick: () => {}, submenu: sets.names.map((name): MenuEntry => ({ label: name, onClick: () => sets.remove(name) })) },
    ],
  }
  const dialog = <RenameDialog name={naming} title={t('menu.saveScreenset')} onClose={() => setNaming(null)} onRename={(name) => sets.save(name.trim())} />
  return { menu, dialog }
}
