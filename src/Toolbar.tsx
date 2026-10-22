// メニューの下の小さなツールバー（WeVocalSynth と同じ形）。再生位置に追従するか、スナップ、拡大と縮小
import type { ReactNode } from 'react'
import { Box } from '@mui/material'
import { DockToolHost, OverflowRow, SmallButton, ToolbarDivider } from 'pevenmui'
import { faArrowsLeftRightToLine, faChartLine, faMagnet, faMagnifyingGlassMinus, faMagnifyingGlassPlus, faWaveSquare, faScissors, faCopy, faPaste, faClone, faSliders, faTrashCan, faCropSimple, faXmark, faCheck, faArrowPointer, faPen, faRotateLeft, type IconDefinition } from '@fortawesome/free-solid-svg-icons'
import { useT, type MessageKey } from './i18n'
import { keyLabel, type Action } from './keymap'
import { countRender } from 'pevenmui/debug'

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
  pitchEnvelope: boolean
  onPitchEnvelope: () => void
  /** 表示しているエンベロープ（なければ null）、道具がペンか、道具の切り替え、選んだブロックのエンベロープの初期化 */
  envKind: 'volume' | 'pitch' | null
  envPen: boolean
  onEnvPen: (pen: boolean) => void
  canEnvReset: boolean
  onEnvReset: () => void
  canCut: boolean
  canPaste: boolean
  hasBlocks: boolean
  hasRange: boolean
  canSplit: boolean
  canDuplicate: boolean
  canDelete: boolean
  canProperties: boolean
  canTrimRange: boolean
  onSplit: () => void
  onDuplicate: () => void
  onDelete: () => void
  onProperties: () => void
  onTrimRange: () => void
  onClearSelection: () => void
  onFollow: () => void
  onSnap: () => void
  onZoom: (factor: number) => void
  onCut: () => void
  onCopy: () => void
  onPaste: () => void
  selectMode: boolean
  selectionCount: number
  showSelectMode: boolean
  onToggleSelectMode: () => void
  children?: ReactNode
}) {
  countRender('Toolbar')
  const t = useT()
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, height: 40, px: 1, flexShrink: 0, borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper' }}>
      <ToolButton icon={faScissors} label="menu.cut" action="cut" disabled={!p.canCut} onClick={p.onCut} />
      <ToolButton icon={faCopy} label="menu.copy" action="copy" disabled={!p.canCut} onClick={p.onCopy} />
      <ToolButton icon={faPaste} label="menu.paste" action="paste" disabled={!p.canPaste} onClick={p.onPaste} />
      <Divider />
      <OverflowRow>
        {p.showSelectMode && (
          <>
            <ToolButton icon={faCheck} label="selection.mode" help="selection.help" pressed={p.selectMode} onClick={p.onToggleSelectMode} />
            {p.selectMode && p.selectionCount > 0 && <Box component="span" sx={{ px: 0.5, color: 'text.secondary', fontSize: 12, whiteSpace: 'nowrap' }}>{t('selection.count', { n: p.selectionCount })}</Box>}
            <Divider />
          </>
        )}
        {p.hasBlocks && (
          <>
            <ToolButton icon={faClone} label="editBar.duplicate" action="duplicate" disabled={!p.canDuplicate} onClick={p.onDuplicate} />
            <ToolButton icon={faArrowsLeftRightToLine} label="editBar.split" action="split" disabled={!p.canSplit} onClick={p.onSplit} />
            <ToolButton icon={faTrashCan} label="editBar.delete" action="delete" disabled={!p.canDelete} onClick={p.onDelete} />
            <ToolButton icon={faSliders} label="editBar.properties" action="properties" disabled={!p.canProperties} onClick={p.onProperties} />
            <ToolButton icon={faXmark} label="editBar.clearRange" action="clearRange" onClick={p.onClearSelection} />
            <Divider />
          </>
        )}
        {p.hasRange && (
          <>
            <ToolButton icon={faCropSimple} label="editBar.trimRange" action="trimRange" disabled={!p.canTrimRange} onClick={p.onTrimRange} />
            {!p.hasBlocks && <ToolButton icon={faXmark} label="editBar.clearRange" action="clearRange" onClick={p.onClearSelection} />}
            <Divider />
          </>
        )}
        <ToolButton icon={faArrowsLeftRightToLine} label="menu.follow" action="follow" pressed={p.follow} onClick={p.onFollow} />
        <ToolButton icon={faMagnet} label="menu.snap" action="snap" pressed={p.snap} onClick={p.onSnap} />
        <ToolButton icon={faChartLine} label="menu.envelope" action="envelope" pressed={p.envelope} onClick={p.onEnvelope} />
        <ToolButton icon={faWaveSquare} label="menu.pitchEnvelope" action="pitchEnvelope" pressed={p.pitchEnvelope} onClick={p.onPitchEnvelope} />
        {p.envKind && (
          <>
            <ToolButton icon={faArrowPointer} label="menu.envelopeSelect" action="envelopeTool" pressed={!p.envPen} onClick={() => p.onEnvPen(false)} />
            <ToolButton icon={faPen} label="menu.envelopePen" action="envelopeTool" pressed={p.envPen} onClick={() => p.onEnvPen(true)} />
            <ToolButton icon={faRotateLeft} label="menu.envelopeReset" action="envelopeReset" disabled={!p.canEnvReset} onClick={p.onEnvReset} />
          </>
        )}
        <Divider />
        <ToolButton icon={faMagnifyingGlassPlus} label="menu.zoomIn" action="zoomIn" onClick={() => p.onZoom(1.5)} />
        <ToolButton icon={faMagnifyingGlassMinus} label="menu.zoomOut" action="zoomOut" onClick={() => p.onZoom(1 / 1.5)} />
        {p.children}
      </OverflowRow>
      {/* 画面の下の欄（ドック）に置いたピアノロールなどが、自分のメニューとボタンを出す場所 */}
      <DockToolHost />
    </Box>
  )
}
