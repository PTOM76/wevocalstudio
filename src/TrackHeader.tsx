// トラックとマスタートラックの左の欄（名前、録音待機、ミュート、ソロ、音量、パン、位相の反転、EQ）。名前はダブルクリックで変える
import { useState, type ReactNode } from 'react'
import { Box, ButtonBase, InputBase, Slider, Tooltip, Typography } from '@mui/material'
import { pevenFont } from 'pevenmui'
import { ContextMenu } from 'pevenmui'
import { useT } from './i18n'
import { isFlatEq } from 'wevocal-lib'
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

/** 音量とパンのスライダー。動かしている間の変更は 1 回分の履歴にまとめる */
function Faders<T extends { volume: number; pan: number }>(p: { value: T; merge: string; onChange: (patch: Partial<T>, merge: string) => void; onEndMerge: () => void; panExtra?: ReactNode }) {
  const t = useT()
  return (
    <>
      <Slider
        size="small"
        min={-60}
        max={12}
        step={0.5}
        value={p.value.volume}
        onChange={(_, v) => p.onChange({ volume: v as number } as Partial<T>, `${p.merge}:volume`)}
        onChangeCommitted={p.onEndMerge}
        onDoubleClick={() => p.onChange({ volume: 0 } as Partial<T>, `${p.merge}:volume`)}
        valueLabelDisplay="auto"
        valueLabelFormat={(v) => `${v} dB`}
        aria-label={t('track.volume')}
      />
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <Slider
          size="small"
          min={-1}
          max={1}
          step={0.01}
          value={p.value.pan}
          track={false}
          onChange={(_, v) => p.onChange({ pan: v as number } as Partial<T>, `${p.merge}:pan`)}
          onChangeCommitted={p.onEndMerge}
          onDoubleClick={() => p.onChange({ pan: 0 } as Partial<T>, `${p.merge}:pan`)}
          aria-label={t('track.pan')}
          sx={{ flex: 1 }}
        />
        {p.panExtra}
      </Box>
    </>
  )
}

export default function TrackHeader(p: {
  track: Track
  height: number
  selected: boolean
  onSelect: () => void
  onChange: (patch: Partial<Track>, merge?: string) => void
  onEndMerge: () => void
  onEq: () => void
  onDuplicate: () => void
  onRemove: () => void
}) {
  const t = useT()
  const { track } = p
  const [editing, setEditing] = useState(false)
  // 右クリックのメニュー（名前の変更、複製、削除）
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  return (
    <Box
      onPointerDown={p.onSelect}
      onContextMenu={(e) => {
        e.preventDefault()
        p.onSelect()
        setMenu({ x: e.clientX, y: e.clientY })
      }}
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
        bgcolor: p.selected ? 'action.selected' : undefined,
        // 選んでいるトラックは左端に色の帯を付ける（WeVocalSynth と同じ）
        boxShadow: p.selected ? (theme) => `inset 3px 0 0 ${theme.palette.primary.main}` : 'none',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
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
          <Typography variant="body2" noWrap sx={{ flex: 1, fontWeight: p.selected ? 600 : 400 }} title={track.name} onDoubleClick={() => setEditing(true)}>
            {track.name}
          </Typography>
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
        panExtra={
          <>
            <MixToggle label="Ø" title={t('track.invert')} on={!!track.invert} color="primary.main" onClick={() => p.onChange({ invert: !track.invert })} />
            {/* EQ。掛けているときは色を付ける */}
            <MixToggle label="EQ" wide title={t('track.eq')} on={!!track.eq && !isFlatEq(track.eq)} color="primary.main" onClick={p.onEq} />
          </>
        }
      />
      <ContextMenu
        position={menu}
        onClose={() => setMenu(null)}
        entries={[
          { label: t('track.rename'), onClick: () => setEditing(true) },
          { label: t('track.duplicate'), onClick: p.onDuplicate },
          { divider: true },
          { label: t('track.remove'), onClick: p.onRemove },
        ]}
      />
    </Box>
  )
}

/** マスタートラックの欄（トラックの一番上。REAPER と同じく、トラックと同じ形で波形ブロックは置かない） */
export function MasterHeader(p: { master: Master; height: number; onChange: (patch: Partial<Master>, merge?: string) => void; onEndMerge: () => void }) {
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
        <Typography variant="body2" sx={{ flex: 1, fontWeight: 500, letterSpacing: 1 }}>
          {t('track.master')}
        </Typography>
        <MixToggle label="M" title={t('track.mute')} on={master.mute} color="warning.main" onClick={() => p.onChange({ mute: !master.mute })} />
      </Box>
      <Faders value={master} merge="master" onChange={p.onChange} onEndMerge={p.onEndMerge} />
    </Box>
  )
}
