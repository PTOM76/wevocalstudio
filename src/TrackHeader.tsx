// トラックとマスタートラックの左の欄（名前、録音待機、ミュート、ソロ、音量、パン、位相の反転、EQ）。名前はダブルクリックで変える
import { useState, type ReactNode } from 'react'
import { Box, InputBase, Slider, ToggleButton, Typography } from '@mui/material'
import { useT } from './i18n'
import { isFlatEq } from 'wevocal-lib'
import type { Master, Track } from './project'

const toggleSx = { py: 0, px: 0.75 }

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
}) {
  const t = useT()
  const { track } = p
  const [editing, setEditing] = useState(false)
  return (
    <Box
      onPointerDown={p.onSelect}
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
          <Typography variant="body2" noWrap sx={{ flex: 1 }} title={track.name} onDoubleClick={() => setEditing(true)}>
            {track.name}
          </Typography>
        )}
        <ToggleButton
          size="small"
          value="r"
          selected={!!track.armed}
          onChange={() => p.onChange({ armed: !track.armed })}
          sx={{ ...toggleSx, color: track.armed ? 'error.main' : undefined, '&.Mui-selected': { color: 'error.main' } }}
          title={t('track.arm')}
        >
          ●
        </ToggleButton>
        <ToggleButton size="small" value="m" selected={track.mute} onChange={() => p.onChange({ mute: !track.mute })} sx={toggleSx} title={t('track.mute')}>
          M
        </ToggleButton>
        <ToggleButton size="small" value="s" selected={track.solo} onChange={() => p.onChange({ solo: !track.solo })} sx={toggleSx} title={t('track.solo')}>
          S
        </ToggleButton>
      </Box>
      <Faders
        value={track}
        merge={`track:${track.id}`}
        onChange={p.onChange}
        onEndMerge={p.onEndMerge}
        panExtra={
          <>
            <ToggleButton size="small" value="inv" selected={!!track.invert} onChange={() => p.onChange({ invert: !track.invert })} sx={toggleSx} title={t('track.invert')}>
              Ø
            </ToggleButton>
            {/* EQ。掛けているときは色を付ける */}
            <ToggleButton size="small" value="eq" selected={!!track.eq && !isFlatEq(track.eq)} onChange={p.onEq} sx={{ ...toggleSx, fontSize: 10 }} title={t('track.eq')}>
              EQ
            </ToggleButton>
          </>
        }
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
        <ToggleButton size="small" value="m" selected={master.mute} onChange={() => p.onChange({ mute: !master.mute })} sx={toggleSx} title={t('track.mute')}>
          M
        </ToggleButton>
      </Box>
      <Faders value={master} merge="master" onChange={p.onChange} onEndMerge={p.onEndMerge} />
    </Box>
  )
}
