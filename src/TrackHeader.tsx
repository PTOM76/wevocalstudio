// トラックの左の欄（名前、ミュート、ソロ、音量、パン）
import { Box, Slider, ToggleButton, Typography } from '@mui/material'
import { useT } from './i18n'
import type { Track } from './project'

export default function TrackHeader(p: { track: Track; height: number; onChange: (patch: Partial<Track>) => void }) {
  const t = useT()
  const { track } = p
  return (
    <Box sx={{ height: p.height, boxSizing: 'border-box', px: 1, py: 0.5, borderBottom: 1, borderColor: 'divider', display: 'flex', flexDirection: 'column', gap: 0.25 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <Typography variant="body2" noWrap sx={{ flex: 1 }} title={track.name}>
          {track.name}
        </Typography>
        <ToggleButton size="small" value="m" selected={track.mute} onChange={() => p.onChange({ mute: !track.mute })} sx={{ py: 0, px: 0.75 }} title={t('track.mute')}>
          M
        </ToggleButton>
        <ToggleButton size="small" value="s" selected={track.solo} onChange={() => p.onChange({ solo: !track.solo })} sx={{ py: 0, px: 0.75 }} title={t('track.solo')}>
          S
        </ToggleButton>
      </Box>
      <Slider size="small" min={-60} max={12} step={0.5} value={track.volume} onChange={(_, v) => p.onChange({ volume: v as number })} valueLabelDisplay="auto" valueLabelFormat={(v) => `${v} dB`} aria-label={t('track.volume')} />
      <Slider size="small" min={-1} max={1} step={0.01} value={track.pan} track={false} onChange={(_, v) => p.onChange({ pan: v as number })} onDoubleClick={() => p.onChange({ pan: 0 })} aria-label={t('track.pan')} />
    </Box>
  )
}
