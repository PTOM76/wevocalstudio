// トラックとマスタートラックの左の欄（名前、録音待機、ミュート、ソロ、音量、パン、位相の反転、EQ）。名前はダブルクリックで変える
import { useRef, useState, type ReactNode } from 'react'
import { Box, ButtonBase, InputBase, Tooltip, Typography } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faSnowflake } from '@fortawesome/free-solid-svg-icons'
import { pevenFont, useDoubleTap, useLongPress } from 'pevenmui'
import { ContextMenu } from 'pevenmui'
import { MeterFader, PanBar } from './MeterFader'
import { useT } from './i18n'
import { isNeutralChain, type FxSlot } from 'wevocal-lib'
import type { Master, Track } from './project'

/** 入り切りの小さなボタン（WeVocalSynth の MixToggle と同じ見た目。入っているときだけ色で塗る） */
function MixToggle(p: { label: string; title: string; on: boolean; color: string; onClick: () => void; wide?: boolean }) {
  return (
    <Tooltip title={p.title}>
      <ButtonBase
        aria-label={p.title}
        aria-pressed={p.on}
        onClick={(e) => {
          // 欄を押したときの「選ぶ」と分ける
          e.stopPropagation()
          p.onClick()
        }}
        onPointerDown={(e) => e.stopPropagation()}
        sx={{
          minWidth: 18,
          px: p.wide ? 0.5 : 0,
          height: 18,
          flexShrink: 0,
          fontSize: pevenFont('xs'),
          fontWeight: 700,
          borderRadius: 0.5,
          bgcolor: p.on ? p.color : 'action.hover',
          color: p.on ? 'common.white' : 'text.secondary',
        }}
      >
        {p.label}
      </ButtonBase>
    </Tooltip>
  )
}

/** 音量（レベルメーターと一つ）とパン。動かしている間の変更は 1 回分の履歴にまとめる */
function Faders<T extends { volume: number; pan: number }>(p: {
  value: T
  merge: string
  onChange: (patch: Partial<T>, merge: string) => void
  onEndMerge: () => void
  panExtra?: ReactNode
  meter?: () => AnalyserNode | readonly AnalyserNode[] | null
  rows?: number
}) {
  const t = useT()
  return (
    <>
      <MeterFader value={p.value.volume} onChange={(volume) => p.onChange({ volume } as Partial<T>, `${p.merge}:volume`)} onCommit={p.onEndMerge} meter={p.meter} rows={p.rows} label={t('track.volume')} />
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <PanBar value={p.value.pan} onChange={(pan) => p.onChange({ pan } as Partial<T>, `${p.merge}:pan`)} onCommit={p.onEndMerge} label={t('track.pan')} />
        {p.panExtra}
      </Box>
    </>
  )
}

/** FX ボタンの文字。掛けているエフェクト（オンのもの）の数を添える */
const fxLabel = (fx: FxSlot[] | undefined) => {
  const n = fx?.filter((s) => s.on).length ?? 0
  return n ? `FX ${n}` : 'FX'
}

export default function TrackHeader(p: {
  track: Track
  height: number
  selected: boolean
  onSelect: (e: React.PointerEvent) => void
  onChange: (patch: Partial<Track>, merge?: string) => void
  onEndMerge: () => void
  onFx: () => void
  onDuplicate: () => void
  /** フリーズとその解除 */
  onFreeze: () => void
  onSends: () => void
  onRemove: () => void
  /** レベルメーター（出さなければ省く） */
  meter?: () => readonly AnalyserNode[] | null
  /** サブトラックの階層の深さ（字下げ）と、子があるか */
  depth: number
  hasChildren: boolean
  onAddSubtrack: () => void
  onIndent: () => void
  onOutdent: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  /** ドラッグで並び替えを始める */
  onReorderStart: (e: React.PointerEvent) => void
  /** 下端ドラッグで高さ変更を始める */
  onResizeStart: (e: React.PointerEvent) => void
  /** ドラッグ中（半透明で表示） */
  dragging?: boolean
}) {
  const t = useT()
  const { track } = p
  const [editing, setEditing] = useState(false)
  // 右クリックのメニュー（名前の変更、複製、削除）
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  // タッチの長押しでメニュー、名前のダブルタップで名前の変更（PevenMUI。iPhone、iPad は contextmenu と dblclick が来ない）
  const longPress = useLongPress()
  const doubleTap = useDoubleTap()
  // 欄のどこをつかんでも並び替えられる（ボタン、つまみ、名前の入力以外を押して、少し動かしたら始める。タッチも同じで、動かしたら長押しのメニューはやめる）
  const grab = useRef<{ x: number; y: number } | null>(null)
  return (
    <Box
      onPointerDown={(e) => {
        p.onSelect(e)
        grab.current = e.button === 0 && !(e.target as HTMLElement).closest('button, input, [role="slider"], .MuiSlider-root') ? { x: e.clientX, y: e.clientY } : null
        if (e.pointerType === 'touch') {
          const { clientX: x, clientY: y } = e
          longPress.start(x, y, () => setMenu({ x, y }))
        }
      }}
      onPointerMove={(e) => {
        longPress.move(e.clientX, e.clientY)
        const g = grab.current
        if (g && Math.hypot(e.clientX - g.x, e.clientY - g.y) > 5) {
          grab.current = null
          longPress.cancel()
          p.onReorderStart(e)
        }
      }}
      onPointerUp={() => {
        grab.current = null
        longPress.cancel()
      }}
      onPointerCancel={() => {
        grab.current = null
        longPress.cancel()
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        p.onSelect(e as unknown as React.PointerEvent)
        setMenu({ x: e.clientX, y: e.clientY })
      }}
      sx={{
        position: 'relative',
        height: p.height,
        opacity: p.dragging ? 0.4 : 1,
        userSelect: 'none',
        touchAction: 'none',
        boxSizing: 'border-box',
        pr: 1,
        // サブトラックは深さだけ字下げする
        pl: 1 + p.depth * 1.5,
        py: 0.5,
        borderBottom: 1,
        borderColor: 'divider',
        display: 'flex',
        flexDirection: 'column',
        gap: 0.25,
        bgcolor: p.selected ? 'action.selected' : undefined,
        // 選んでいるトラックは左端に色の帯を付ける（WeVocalSynth と同じ）
        boxShadow: p.selected ? (theme) => `inset 3px 0 0 ${theme.palette.primary.main}` : 'none',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        {/* 子があるトラックは、たたむ、開くの印 */}
        {p.hasChildren && (
          <ButtonBase
            aria-label={t(track.collapsed ? 'track.expand' : 'track.collapse')}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => p.onChange({ collapsed: !track.collapsed })}
            sx={{ width: 14, fontSize: pevenFont('xs'), color: 'text.secondary' }}
          >
            {track.collapsed ? '▸' : '▾'}
          </ButtonBase>
        )}
        {editing ? (
          <InputBase
            autoFocus
            defaultValue={track.name}
            size="small"
            sx={{ flex: 1, fontSize: 14 }}
            onFocus={(e) => e.target.select()}
            onBlur={(e) => {
              const name = e.target.value.trim()
              if (name && name !== track.name) p.onChange({ name })
              setEditing(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              if (e.key === 'Escape') setEditing(false)
            }}
          />
        ) : (
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2" noWrap sx={{ flex: 1, fontWeight: p.selected ? 600 : 400 }} title={track.name} onDoubleClick={() => setEditing(true)} onPointerUp={(e) => e.pointerType === 'touch' && doubleTap.tap(e.clientX, e.clientY) && setEditing(true)}>
            {/* フリーズ中の印 */}
            {track.frozen && (
              <Tooltip title={t('track.frozen')}>
                <FontAwesomeIcon icon={faSnowflake} style={{ marginRight: 4, opacity: 0.7 }} />
              </Tooltip>
            )}
            {track.name}
          </Typography>
          </Box>
        )}
        <MixToggle label="●" title={t('track.arm')} on={!!track.armed} color="error.main" onClick={() => p.onChange({ armed: !track.armed })} />
        <MixToggle label="M" title={t('track.mute')} on={track.mute} color="warning.main" onClick={() => p.onChange({ mute: !track.mute })} />
        <MixToggle label="S" title={t('track.solo')} on={track.solo} color="success.main" onClick={() => p.onChange({ solo: !track.solo })} />
      </Box>
      <Faders
        value={track}
        merge={`track:${track.id}`}
        onChange={p.onChange}
        onEndMerge={p.onEndMerge}
        meter={p.meter}
        rows={2}
        panExtra={
          <>
            <MixToggle label="Ø" title={t('track.invert')} on={!!track.invert} color="primary.main" onClick={() => p.onChange({ invert: !track.invert })} />
            {/* FX の列。何か掛けているときは色を付ける */}
            <MixToggle label={fxLabel(track.fx)} wide title={t('track.fx')} on={!isNeutralChain(track.fx)} color="primary.main" onClick={p.onFx} />
          </>
        }
      />
      <ContextMenu
        position={menu}
        onClose={() => setMenu(null)}
        entries={[
          { label: t('track.rename'), onClick: () => setEditing(true) },
          { label: t('track.duplicate'), onClick: p.onDuplicate },
          { label: t(track.frozen ? 'track.unfreeze' : 'track.freeze'), onClick: p.onFreeze },
          { label: t('track.sends'), onClick: p.onSends },
          { divider: true },
          { label: t('track.addSubtrack'), onClick: p.onAddSubtrack },
          { label: t('track.indent'), onClick: p.onIndent },
          { label: t('track.outdent'), disabled: !track.parent, onClick: p.onOutdent },
          { divider: true },
          { label: t('track.moveUp'), onClick: p.onMoveUp },
          { label: t('track.moveDown'), onClick: p.onMoveDown },
          { divider: true },
          { label: t('track.remove'), onClick: p.onRemove },
        ]}
      />
      <Box
        onPointerDown={(e) => {
          e.stopPropagation()
          p.onResizeStart(e)
        }}
        sx={{ position: 'absolute', left: 0, right: 0, bottom: -3, height: 6, cursor: 'ns-resize', touchAction: 'none', zIndex: 2 }}
      />
    </Box>
  )
}

/** マスタートラックの欄（トラックの一番上。トラックと同じ形で波形ブロックは置かない） */
export function MasterHeader(p: { master: Master; height: number; onFx: () => void; onChange: (patch: Partial<Master>, merge?: string) => void; onEndMerge: () => void; meter?: () => readonly AnalyserNode[] | null }) {
  const t = useT()
  const { master } = p
  return (
    <Box
      sx={{
        height: p.height,
        boxSizing: 'border-box',
        px: 1,
        py: 0.5,
        borderBottom: 1,
        borderColor: 'divider',
        display: 'flex',
        flexDirection: 'column',
        gap: 0.25,
        bgcolor: 'action.hover',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 500, letterSpacing: 1 }}>
            {t('track.master')}
          </Typography>
        </Box>
        <MixToggle label={fxLabel(master.fx)} wide title={t('track.fx')} on={!isNeutralChain(master.fx)} color="primary.main" onClick={p.onFx} />
        <MixToggle label="M" title={t('track.mute')} on={master.mute} color="warning.main" onClick={() => p.onChange({ mute: !master.mute })} />
      </Box>
      <Faders value={master} merge="master" onChange={p.onChange} onEndMerge={p.onEndMerge} meter={p.meter} rows={2} />
    </Box>
  )
}
