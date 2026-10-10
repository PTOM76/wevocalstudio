// メニューの下の小さなツールバー（WeVocalSynth と同じ形）。再生位置に追従するか、スナップ、拡大と縮小
import type { ReactNode } from 'react'
import { Box } from '@mui/material'
import { SmallButton, ToolbarDivider } from 'pevenmui'
import { faArrowsLeftRightToLine, faChartLine, faMagnet, faMagnifyingGlassMinus, faMagnifyingGlassPlus, faScissors, faCopy, faPaste, type IconDefinition } from '@fortawesome/free-solid-svg-icons'
import { useT, type MessageKey } from './i18n'
import { keyLabel, type Action } from './keymap'

/** ツールバーのボタン（PevenMUI の SmallButton。ツールチップは名前とキー、help があればその説明） */
export function ToolButton(p: { icon: IconDefinition; label: MessageKey; help?: MessageKey; action?: Action; pressed?: boolean; disabled?: boolean; onClick: () => void }) {
  const t = useT()
  const key = p.action && keyLabel(p.action)
  const name = key ? `${t(p.label)} (${key})` : t(p.label)
  return <SmallButton title={p.help ? `${name}: ${t(p.help)}` : name} label={t(p.label)} icon={p.icon} pressed={p.pressed} disabled={p.disabled} onClick={p.onClick} />
}

/** 操作のまとまりの区切り線（PevenMUI。WeVocalSynth と同じ） */
export const Divider = () => <ToolbarDivider gap />

export default function Toolbar(p: {
  follow: boolean
  snap: boolean
  envelope: boolean
  onEnvelope: () => void
  canCut: boolean
  canPaste: boolean
  onFollow: () => void
  onSnap: () => void
  onZoom: (factor: number) => void
  onCut: () => void
  onCopy: () => void
  onPaste: () => void
  children?: ReactNode
}) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, height: 40, px: 1, flexShrink: 0, borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper' }}>
      <ToolButton icon={faScissors} label="menu.cut" action="cut" disabled={!p.canCut} onClick={p.onCut} />
      <ToolButton icon={faCopy} label="menu.copy" action="copy" disabled={!p.canCut} onClick={p.onCopy} />
      <ToolButton icon={faPaste} label="menu.paste" action="paste" disabled={!p.canPaste} onClick={p.onPaste} />
      <Divider />
      <ToolButton icon={faArrowsLeftRightToLine} label="menu.follow" action="follow" pressed={p.follow} onClick={p.onFollow} />
      <ToolButton icon={faMagnet} label="menu.snap" action="snap" pressed={p.snap} onClick={p.onSnap} />
      <ToolButton icon={faChartLine} label="menu.envelope" action="envelope" pressed={p.envelope} onClick={p.onEnvelope} />
      <Divider />
      <ToolButton icon={faMagnifyingGlassPlus} label="menu.zoomIn" action="zoomIn" onClick={() => p.onZoom(1.5)} />
      <ToolButton icon={faMagnifyingGlassMinus} label="menu.zoomOut" action="zoomOut" onClick={() => p.onZoom(1 / 1.5)} />
      {p.children}
    </Box>
  )
}
