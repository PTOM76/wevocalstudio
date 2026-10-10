// 上部のバー（WeVocalSynth の AppHeader と同じ）。PC は低いメニューバー、スマホは上部バー。右端に元に戻す、やり直し
import { faRotateLeft, faRotateRight } from '@fortawesome/free-solid-svg-icons'
import { AppHeader as PevenAppHeader, HeaderIcon, type MenuGroup } from 'pevenmui'
import { useT } from './i18n'
import { keyLabel } from './keymap'

/** アプリのアイコン（public/icon.svg）。サブパスで配信されても読めるよう BASE_URL から組み立てる */
export const AppIcon = ({ size }: { size: number }) => <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" width={size} height={size} style={{ display: 'block' }} />

export default function AppHeader(p: { menus: MenuGroup[]; canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void; projectName: string; dirty: boolean }) {
  const t = useT()
  const tip = (label: string, key: string) => (key ? `${label} (${key})` : label)
  return (
    <PevenAppHeader
      title={(p.dirty ? '* ' : '') + p.projectName}
      icon={<AppIcon size={16} />}
      menus={p.menus}
      actions={(mobile) => (
        <>
          <HeaderIcon small={!mobile} title={tip(t('menu.undo'), mobile ? '' : keyLabel('undo'))} icon={faRotateLeft} disabled={!p.canUndo} onClick={p.onUndo} />
          <HeaderIcon small={!mobile} title={tip(t('menu.redo'), mobile ? '' : keyLabel('redo'))} icon={faRotateRight} disabled={!p.canRedo} onClick={p.onRedo} />
        </>
      )}
    />
  )
}
