// ピアノロールで音符を長押ししたときのメニュー（削除、コピー、複製）
import { ContextMenu } from 'pevenmui'
import { useT } from '../i18n'
import type { RollEdit } from './Toolbar'

export default function NoteMenu(p: { position: { x: number; y: number } | null; onClose: () => void; edit: RollEdit; selected: string[] }) {
  const t = useT()
  return (
    <ContextMenu
      position={p.position}
      entries={[
        { label: t('roll.remove'), onClick: () => p.edit.remove(p.selected) },
        { label: t('menu.copy'), onClick: () => p.edit.copy(false) },
        { label: t('menu.duplicate'), onClick: p.edit.duplicate },
      ]}
      onClose={p.onClose}
    />
  )
}
