// 再生のボタン一式（REAPER のトランスポート。先頭へ、停止、再生、一時停止、リピート、末尾へ）と時間の表示。見た目は WeVocalSynth のツールバーと同じ
import { Box, IconButton, Tooltip, Typography } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faBackwardStep, faForwardStep, faPause, faPlay, faRepeat, faStop, type IconDefinition } from '@fortawesome/free-solid-svg-icons'
import type { Range } from 'wevocal-lib'
import { useT, type MessageKey } from './i18n'
import { keyLabel, type Action } from './keymap'

export const formatTime = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(3).padStart(6, '0')}`

function Button(p: { icon: IconDefinition; label: MessageKey; action: Action; onClick: () => void; pressed?: boolean; primary?: boolean }) {
  const t = useT()
  return (
    <Tooltip title={keyLabel(p.action) ? `${t(p.label)} (${keyLabel(p.action)})` : t(p.label)}>
      <IconButton size="small" aria-label={t(p.label)} aria-pressed={p.pressed} color={p.primary || p.pressed ? 'primary' : 'default'} onClick={p.onClick} sx={{ width: 32, height: 32, fontSize: 14 }}>
        <FontAwesomeIcon icon={p.icon} />
      </IconButton>
    </Tooltip>
  )
}

export default function Transport(p: {
  playing: boolean
  cursor: number
  end: number
  range: Range | null
  repeat: boolean
  onToStart: () => void
  onStop: () => void
  onPlay: () => void
  onPause: () => void
  onRepeat: () => void
  onToEnd: () => void
}) {
  const t = useT()
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1, height: 40, flexShrink: 0, borderTop: 1, borderColor: 'divider', bgcolor: 'background.paper' }}>
      <Button icon={faBackwardStep} label="transport.toStart" action="toStart" onClick={p.onToStart} />
      <Button icon={faStop} label="transport.stop" action="stop" onClick={p.onStop} />
      <Button icon={faPlay} label="transport.play" action="playStop" onClick={p.onPlay} primary={p.playing} />
      <Button icon={faPause} label="transport.pause" action="pause" onClick={p.onPause} />
      <Button icon={faRepeat} label="transport.repeat" action="repeat" onClick={p.onRepeat} pressed={p.repeat} />
      <Button icon={faForwardStep} label="transport.toEnd" action="toEnd" onClick={p.onToEnd} />
      <Typography className="selectable" sx={{ ml: 1.5, fontFamily: 'monospace', fontSize: 16 }}>
        {formatTime(p.cursor)}
      </Typography>
      <Typography sx={{ color: 'text.secondary', fontSize: 12, fontFamily: 'monospace' }}>/ {formatTime(p.end)}</Typography>
      {p.range && (
        <Typography sx={{ ml: 2, color: 'text.secondary', fontSize: 12 }}>
          {t('transport.range')}: <span style={{ fontFamily: 'monospace' }}>{formatTime(p.range.start)} – {formatTime(p.range.end)}</span>
        </Typography>
      )}
    </Box>
  )
}
