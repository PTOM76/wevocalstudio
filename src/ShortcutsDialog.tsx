// ショートカットの一覧のダイアログ（部品は PevenMUI の ShortcutsDialog。WeVocalSynth と同じ）
import { ShortcutsDialog as PevenShortcutsDialog, keymapRows } from 'pevenmui'
import { useT, type MessageKey } from './i18n'
import { ACTIONS, currentKeymap } from './keymap'

/** マウスなど、割り当てを変えられない操作: [キーの訳文キー, 説明の訳文キー] */
const POINTER: [MessageKey, MessageKey][] = [
  ['shortcuts.drag', 'shortcuts.moveBlock'],
  ['shortcuts.altDrag', 'shortcuts.slip'],
  ['shortcuts.ctrlDrag', 'shortcuts.copyBlock'],
  ['shortcuts.shiftDrag', 'shortcuts.noSnap'],
  ['shortcuts.laneDrag', 'shortcuts.range'],
  ['shortcuts.rightDrag', 'shortcuts.marquee'],
  ['shortcuts.shiftClick', 'shortcuts.addSelect'],
  ['shortcuts.rightClick', 'shortcuts.contextMenu'],
  ['shortcuts.wheel', 'shortcuts.scroll'],
]

/** キーボードとマウスの操作の一覧。キーボードは今の割り当て（設定で変えたもの）を、キーのある操作だけ並べる */
export default function ShortcutsDialog(p: { open: boolean; onClose: () => void }) {
  const t = useT()
  const keys = keymapRows(ACTIONS.map((a) => ({ id: a.id, label: t(`menu.${a.id}` as MessageKey) })), currentKeymap())
  return <PevenShortcutsDialog open={p.open} onClose={p.onClose} title={t('menu.shortcuts')} rows={[...keys, ...POINTER.map(([key, desc]): [string, string] => [t(key), t(desc)])]} />
}
