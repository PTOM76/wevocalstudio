// 再生のボタン一式（REAPER のトランスポート。先頭へ、停止、再生、一時停止、リピート、末尾へ）と時間の表示。見た目は WeVocalSynth のツールバーと同じ
import { useEffect, useState, type ReactNode } from 'react'
import { Box, IconButton, InputBase, Tooltip, Typography } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faBackwardStep, faCircle, faForwardStep, faPause, faPlay, faRepeat, faStop, type IconDefinition } from '@fortawesome/free-solid-svg-icons'
import type { Range } from 'wevocal-lib'
import { useT, type MessageKey } from './i18n'
import { keyLabel, type Action } from './keymap'
import type { Tempo } from './project'
import { GRID_MAX, GRID_MIN, type GridDivision } from './grid'

export const formatTime = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(3).padStart(6, '0')}`

function Button(p: { icon: IconDefinition; label: MessageKey; action: Action; onClick: () => void; pressed?: boolean; primary?: boolean; danger?: boolean }) {
  const t = useT()
  return (
    <Tooltip title={keyLabel(p.action) ? `${t(p.label)} (${keyLabel(p.action)})` : t(p.label)}>
      <IconButton size="small" aria-label={t(p.label)} aria-pressed={p.pressed} color={p.danger ? 'error' : p.primary || p.pressed ? 'primary' : 'default'} onClick={p.onClick} sx={{ width: 32, height: 32, fontSize: 14 }}>
        <FontAwesomeIcon icon={p.icon} />
      </IconButton>
    </Tooltip>
  )
}

/** 数を打つ小さな欄。Enter か欄を離れたときに決める（打っている途中では変えない） */
function NumberField(p: { value: number; min: number; max: number; step: number; width: number; label: string; onChange: (v: number) => void }) {
  const [draft, setDraft] = useState(String(p.value))
  useEffect(() => setDraft(String(p.value)), [p.value])
  const commit = () => {
    const v = Number(draft)
    if (Number.isFinite(v) && v >= p.min && v <= p.max) p.onChange(v)
    else setDraft(String(p.value))
  }
  return (
    <InputBase
      value={draft}
      type="number"
      inputProps={{ min: p.min, max: p.max, step: p.step, 'aria-label': p.label }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      sx={{ width: p.width, fontSize: 13, fontFamily: 'monospace', '& input': { textAlign: 'right', py: 0.25 } }}
    />
  )
}

/** 時間の表示。再生中はこの部品だけが毎フレーム位置を読んで描き直す */
function LiveTime(p: { playing: boolean; cursor: number; livePos: () => number | null }) {
  const [now, setNow] = useState(p.cursor)
  useEffect(() => {
    setNow(p.livePos() ?? p.cursor)
    if (!p.playing) return
    let id = 0
    const tick = () => {
      setNow(p.livePos() ?? p.cursor)
      id = requestAnimationFrame(tick)
    }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
  }, [p.playing, p.cursor, p.livePos])
  return <>{formatTime(now)}</>
}

export default function Transport(p: {
  playing: boolean
  cursor: number
  livePos: () => number | null
  /** マスターのレベルメーター（時間の横。WeVocalSynth のツールバーと同じ） */
  meter: ReactNode
  end: number
  range: Range | null
  repeat: boolean
  recording: boolean
  onRecord: () => void
  tempo: Tempo
  onTempo: (patch: Partial<Tempo>) => void
  /** グリッドの細かさ（1/1〜1/256） */
  division: GridDivision
  onDivision: (d: GridDivision) => void
  onToStart: () => void
  onStop: () => void
  onPause: () => void
  onRepeat: () => void
  onToEnd: () => void
}) {
  const t = useT()
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1, height: 40, flexShrink: 0, borderTop: 1, borderColor: 'divider', bgcolor: 'background.paper' }}>
      <Button icon={faBackwardStep} label="transport.toStart" action="toStart" onClick={p.onToStart} />
      <Button icon={faStop} label="transport.stop" action="stop" onClick={p.onStop} />
      {/* 再生と一時停止は 1 つのボタン（WeVocalSynth と同じ）。停止は止めて、再生を始めた位置に戻る */}
      <Button icon={p.playing ? faPause : faPlay} label={p.playing ? 'transport.pause' : 'transport.play'} action="pause" onClick={p.onPause} primary />
      <Button icon={faCircle} label="transport.record" action="record" onClick={p.onRecord} pressed={p.recording} danger />
      <Button icon={faRepeat} label="transport.repeat" action="repeat" onClick={p.onRepeat} pressed={p.repeat} />
      <Button icon={faForwardStep} label="transport.toEnd" action="toEnd" onClick={p.onToEnd} />
      <Typography className="selectable" sx={{ ml: 1.5, fontFamily: 'monospace', fontSize: 16 }}>
        <LiveTime playing={p.playing} cursor={p.cursor} livePos={p.livePos} />
      </Typography>
      <Typography sx={{ color: 'text.secondary', fontSize: 12, fontFamily: 'monospace' }}>/ {formatTime(p.end)}</Typography>
      <Box sx={{ ml: 1.5 }}>{p.meter}</Box>
      <Box sx={{ ml: 2, display: 'flex', alignItems: 'center', gap: 0.5, color: 'text.secondary', fontSize: 12 }}>
        <span>BPM</span>
        <NumberField value={p.tempo.bpm} min={20} max={400} step={0.1} width={64} label="BPM" onChange={(bpm) => p.onTempo({ bpm })} />
        <span style={{ marginLeft: 8 }}>{t('transport.beatsPerBar')}</span>
        <NumberField value={p.tempo.beatsPerBar} min={1} max={16} step={1} width={40} label={t('transport.beatsPerBar')} onChange={(beatsPerBar) => p.onTempo({ beatsPerBar: Math.round(beatsPerBar) })} />
        <span>/4</span>
        <span style={{ marginLeft: 8 }}>{t('transport.grid')}</span>
        <span>1/</span>
        <NumberField value={p.division} min={GRID_MIN} max={GRID_MAX} step={1} width={44} label={t('transport.grid')} onChange={(d) => p.onDivision(Math.round(d))} />
      </Box>
      {p.range && (
        <Typography sx={{ ml: 2, color: 'text.secondary', fontSize: 12 }}>
          {t('transport.range')}: <span style={{ fontFamily: 'monospace' }}>{formatTime(p.range.start)} – {formatTime(p.range.end)}</span>
        </Typography>
      )}
    </Box>
  )
}
