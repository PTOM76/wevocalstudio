// 波形ブロックを選んだときに画面の下に出す編集のボタンの列（半音の上げ下げ、切り取り、コピー、貼り付け、複製、分割、削除、プロパティ、確定。PevenMUI の EditBar）
import { faArrowDown, faArrowUp, faClone, faCopy, faPaste, faScissors, faSliders, faTrashCan, faCheck } from '@fortawesome/free-solid-svg-icons'
import { EDIT_BAR_DIVIDER, EditBar, type EditBarItem } from 'pevenmui'
import { useT } from './i18n'
import type { Action } from './keymap'

/** 実行できるか、実行する（useActions の commands） */
type Commands = Record<Action, { run: () => void; enabled?: boolean }>

export default function BlockEditBar({ commands }: { commands: Commands }) {
  const t = useT()
  const button = (action: Action, icon: EditBarItem['icon']): EditBarItem => ({ label: t(`editBar.${action}` as 'editBar.cut'), icon, onClick: commands[action].run, disabled: commands[action].enabled === false })
  return (
    <EditBar
      items={[
        button('pitchDown', faArrowDown),
        button('pitchUp', faArrowUp),
        EDIT_BAR_DIVIDER,
        button('cut', faScissors),
        button('copy', faCopy),
        button('paste', faPaste),
        button('duplicate', faClone),
        button('split', faScissors),
        button('delete', faTrashCan),
        EDIT_BAR_DIVIDER,
        button('properties', faSliders),
        button('bake', faCheck),
      ]}
    />
  )
}
