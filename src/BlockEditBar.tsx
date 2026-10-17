// 画面の下に出す編集のボタンの列（PevenMUI の EditBar）。波形ブロックを選んでいれば波形ブロックの編集、範囲を選んでいれば範囲の編集
import { faArrowDown, faArrowUp, faArrowsRotate, faArrowsLeftRightToLine, faCheck, faClone, faCopy, faEraser, faHeadphones, faPaste, faRepeat, faScissors, faSliders, faTrashCan, faVolumeHigh, faXmark } from '@fortawesome/free-solid-svg-icons'
import { EDIT_BAR_DIVIDER, EditBar, type EditBarItem } from 'pevenmui'
import { useT } from './i18n'
import type { Action } from './keymap'

/** 実行できるか、実行する（useActions の commands） */
type Commands = Record<Action, { run: () => void; enabled?: boolean }>

/** 並べるボタン（操作の名前とアイコン）。波形ブロックを選んでいるとき */
const BLOCK: ([Action, EditBarItem['icon']] | typeof EDIT_BAR_DIVIDER)[] = [
  ['pitchDown', faArrowDown],
  ['pitchUp', faArrowUp],
  ['pitchReset', faArrowsRotate],
  EDIT_BAR_DIVIDER,
  ['cut', faScissors],
  ['copy', faCopy],
  ['paste', faPaste],
  ['duplicate', faClone],
  ['split', faArrowsLeftRightToLine],
  ['delete', faTrashCan],
  EDIT_BAR_DIVIDER,
  ['normalize', faVolumeHigh],
  ['properties', faSliders],
  ['bake', faCheck],
]

/** 範囲を選んでいるとき */
const RANGE: ([Action, EditBarItem['icon']] | typeof EDIT_BAR_DIVIDER)[] = [
  ['playRange', faHeadphones],
  ['splitRange', faArrowsLeftRightToLine],
  EDIT_BAR_DIVIDER,
  ['trimRange', faScissors],
  ['deleteRange', faTrashCan],
  ['insertSilence', faEraser],
  ['repeatRange', faRepeat],
  EDIT_BAR_DIVIDER,
  ['clearRange', faXmark],
]

export default function BlockEditBar({ commands, mode, top }: { commands: Commands; mode: 'block' | 'range'; top?: boolean }) {
  const t = useT()
  const items = (mode === 'block' ? BLOCK : RANGE).map((x): EditBarItem | typeof EDIT_BAR_DIVIDER =>
    x === EDIT_BAR_DIVIDER ? x : { label: t(`editBar.${x[0]}` as 'editBar.cut'), icon: x[1], onClick: commands[x[0]].run, disabled: commands[x[0]].enabled === false },
  )
  return <EditBar items={items} top={top} />
}
