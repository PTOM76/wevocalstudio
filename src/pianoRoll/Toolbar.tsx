// ピアノロールのツールバー（道具、グリッド、編集、変換のメニュー、ズーム、再生）。ダイアログと別のウィンドウに出したときに使う。メイン画面のドックでは既存のツールバーを使う（PianoRoll の toolbar）
import { useState } from 'react'
import { Box, Button, IconButton, Popover, Switch, Tooltip, Typography } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faArrowPointer, faArrowsLeftRightToLine, faCaretDown, faCircleQuestion, faClone, faCopy, faEraser, faGripLinesVertical, faMagnet, faMagnifyingGlassMinus, faMagnifyingGlassPlus, faPaste, faPause, faPencil, faPlay, faScissors, faTrashCan, faVolumeXmark, type IconDefinition } from '@fortawesome/free-solid-svg-icons'
import { ContextMenu, NumberInput, SmallButton, ToolbarDivider, pevenFont, type MenuEntry } from 'pevenmui'
import { LabeledSelect as Choice } from 'wevocal-lib/react'
import { useT } from '../i18n'

export type Tool = 'select' | 'pen' | 'erase' | 'slice' | 'mute'

/** クオンタイズの設定（強さとスイングは %） */
export interface QuantizeForm {
  start: boolean
  length: boolean
  strength: number
  swing: number
}

/** ヒューマナイズの設定（時間は拍の 1/100、強さは %） */
export interface HumanizeForm {
  time: number
  vel: number
}

export interface RollToolbarProps {
  division: number
  divisions: [number, string][]
  onDivision: (division: number) => void
  snapOn: boolean
  onSnap: () => void
  tool: Tool
  onTool: (tool: Tool) => void
  /** 選んでいる音符の数 */
  selected: number
  canPaste: boolean
  playing: boolean
  onTogglePlay: () => void
  onCut: () => void
  onCopy: () => void
  onPaste: () => void
  onDuplicate: () => void
  onRemove: () => void
  onTranspose: (semis: number) => void
  onQuantize: (f: QuantizeForm) => void
  onLegato: () => void
  onGlue: () => void
  onHumanize: (f: HumanizeForm) => void
  onZoom: (factor: number) => void
  onFit: () => void
}

export default function RollToolbar(p: RollToolbarProps) {
  const t = useT()
  const none = p.selected === 0
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  // 設定の入力（変換のメニューから開く。値は覚えておく）
  const [form, setForm] = useState<{ kind: 'quantize' | 'humanize'; x: number; y: number } | null>(null)
  const [q, setQ] = useState<QuantizeForm>({ start: true, length: true, strength: 100, swing: 0 })
  const [h, setH] = useState<HumanizeForm>({ time: 5, vel: 10 })
  const btn = (title: string, icon: IconDefinition, onClick: () => void, o: { disabled?: boolean; pressed?: boolean } = {}) => <SmallButton title={title} label={title} icon={icon} onClick={onClick} {...o} />
  const tool = (id: Tool, title: string, icon: IconDefinition) => btn(title, icon, () => p.onTool(id), { pressed: p.tool === id })

  const entries = (at: { x: number; y: number }): MenuEntry[] => [
    { label: t('roll.up'), shortcut: '↑', disabled: none, onClick: () => p.onTranspose(1) },
    { label: t('roll.down'), shortcut: '↓', disabled: none, onClick: () => p.onTranspose(-1) },
    { label: t('roll.octaveUp'), shortcut: 'Shift+↑', disabled: none, onClick: () => p.onTranspose(12) },
    { label: t('roll.octaveDown'), shortcut: 'Shift+↓', disabled: none, onClick: () => p.onTranspose(-12) },
    { divider: true },
    { label: t('roll.quantize'), shortcut: 'Q', disabled: none, onClick: () => p.onQuantize(q) },
    { label: t('roll.quantizeSettings'), disabled: none, onClick: () => setForm({ kind: 'quantize', ...at }) },
    { label: t('roll.legato'), disabled: none, onClick: p.onLegato },
    { label: t('roll.glue'), shortcut: 'Ctrl+G', disabled: p.selected < 2, onClick: p.onGlue },
    { label: t('roll.humanize'), disabled: none, onClick: () => setForm({ kind: 'humanize', ...at }) },
  ]

  const row = (label: string, control: React.ReactNode) => (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
      <Typography sx={{ fontSize: pevenFont('base') }}>{label}</Typography>
      {control}
    </Box>
  )

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap', pt: 1 }}>
      <Box sx={{ width: 110, mr: 0.5 }}>
        <Choice label={t('roll.grid')} value={p.division} options={p.divisions} onChange={p.onDivision} />
      </Box>
      {btn(t('menu.snap'), faMagnet, p.onSnap, { pressed: p.snapOn })}
      <ToolbarDivider gap />
      {tool('select', t('roll.toolSelect'), faArrowPointer)}
      {tool('pen', t('roll.toolPen'), faPencil)}
      {tool('erase', t('roll.toolErase'), faEraser)}
      {tool('slice', t('roll.toolSlice'), faGripLinesVertical)}
      {tool('mute', t('roll.toolMute'), faVolumeXmark)}
      <ToolbarDivider gap />
      {btn(t('menu.cut'), faScissors, p.onCut, { disabled: none })}
      {btn(t('menu.copy'), faCopy, p.onCopy, { disabled: none })}
      {btn(t('menu.paste'), faPaste, p.onPaste, { disabled: !p.canPaste })}
      {btn(t('menu.duplicate'), faClone, p.onDuplicate, { disabled: none })}
      {btn(t('roll.remove'), faTrashCan, p.onRemove, { disabled: none })}
      <ToolbarDivider gap />
      <Button size="small" endIcon={<FontAwesomeIcon icon={faCaretDown} />} onClick={(e) => setMenu({ x: e.currentTarget.getBoundingClientRect().left, y: e.currentTarget.getBoundingClientRect().bottom })}>
        {t('roll.menuConvert')}
      </Button>
      <ContextMenu position={menu} entries={menu ? entries(menu) : []} onClose={() => setMenu(null)} />
      <ToolbarDivider gap />
      {btn(t('roll.zoomIn'), faMagnifyingGlassPlus, () => p.onZoom(1.4))}
      {btn(t('roll.zoomOut'), faMagnifyingGlassMinus, () => p.onZoom(1 / 1.4))}
      {btn(t('roll.zoomFit'), faArrowsLeftRightToLine, p.onFit)}
      <ToolbarDivider gap />
      {btn(t(p.playing ? 'roll.pause' : 'roll.play'), p.playing ? faPause : faPlay, p.onTogglePlay)}
      <Box sx={{ flex: 1 }} />
      <Tooltip title={<Box sx={{ whiteSpace: 'pre-line', fontSize: pevenFont('sm') }}>{t('roll.help')}</Box>} placement="bottom-end">
        <IconButton size="small" aria-label={t('roll.helpButton')}>
          <FontAwesomeIcon icon={faCircleQuestion} />
        </IconButton>
      </Tooltip>
      <Popover open={!!form} onClose={() => setForm(null)} anchorReference="anchorPosition" anchorPosition={form ? { top: form.y, left: form.x } : undefined}>
        <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.5, minWidth: 260 }}>
          {form?.kind === 'quantize' && (
            <>
              {row(t('roll.qStart'), <Switch size="small" checked={q.start} onChange={(e) => setQ({ ...q, start: e.target.checked })} />)}
              {row(t('roll.qLength'), <Switch size="small" checked={q.length} onChange={(e) => setQ({ ...q, length: e.target.checked })} />)}
              {row(t('roll.qStrength'), <NumberInput value={q.strength} onChange={(v) => setQ({ ...q, strength: v })} min={0} max={100} step={5} unit="%" width={88} ariaLabel={t('roll.qStrength')} />)}
              {row(t('roll.qSwing'), <NumberInput value={q.swing} onChange={(v) => setQ({ ...q, swing: v })} min={0} max={100} step={5} unit="%" width={88} ariaLabel={t('roll.qSwing')} />)}
            </>
          )}
          {form?.kind === 'humanize' && (
            <>
              {row(t('roll.hTime'), <NumberInput value={h.time} onChange={(v) => setH({ ...h, time: v })} min={0} max={50} step={1} unit="/100" width={88} ariaLabel={t('roll.hTime')} />)}
              {row(t('roll.hVel'), <NumberInput value={h.vel} onChange={(v) => setH({ ...h, vel: v })} min={0} max={50} step={1} unit="%" width={88} ariaLabel={t('roll.hVel')} />)}
            </>
          )}
          <Button
            size="small"
            sx={{ alignSelf: 'flex-end' }}
            onClick={() => {
              if (form?.kind === 'quantize') p.onQuantize(q)
              else p.onHumanize(h)
              setForm(null)
            }}
          >
            {t('roll.apply')}
          </Button>
        </Box>
      </Popover>
    </Box>
  )
}
