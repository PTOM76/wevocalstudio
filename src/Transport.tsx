// 再生のボタン一式（先頭へ、停止、再生と一時停止、録音、リピート、末尾へ）、時間の表示、マスターのメーター、テンポとグリッド。部品は WeVocalSynth のツールバーと同じ
import type { ReactNode } from 'react'
import { IconButton, Stack, Tooltip, Typography } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faBackwardStep, faCircle, faForwardStep, faPause, faPlay, faRepeat, faStop } from '@fortawesome/free-solid-svg-icons'
import { LiveTime, NumberInput, SmallButton, ToolbarDivider, pevenFont } from 'pevenmui'
import { useT, type MessageKey } from './i18n'
import { keyLabel, type Action } from './keymap'
import type { Tempo } from './project'
import { GRID_MAX, GRID_MIN, type GridDivision } from './grid'

export { formatTime } from 'pevenmui'

/** 数の欄の前の小さな名前 */
const Label = ({ children }: { children: ReactNode }) => <Typography sx={{ fontSize: pevenFont('sm'), color: 'text.secondary', mx: 0.5 }}>{children}</Typography>

export default function Transport(p: {
  playing: boolean
  /** 止まっているときの位置（再生カーソルか編集カーソル） */
  position: number
  /** 再生中の今の位置（時間の表示が自分で読む） */
  livePosition: () => number
  /** 時間を押して入れた位置へ移る */
  onSeek: (t: number) => void
  /** マスターのレベルメーター（時間の横。WeVocalSynth のツールバーと同じ） */
  meter: ReactNode
  end: number
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
  // ツールチップは名前と今のキーの割り当て（WeVocalSynth の withKey と同じ）
  const tip = (label: MessageKey, action: Action) => (keyLabel(action) ? `${t(label)} (${keyLabel(action)})` : t(label))
  return (
    <Stack
      direction="row"
      spacing={0.5}
      divider={<ToolbarDivider />}
      sx={{ height: 40, px: 1, flexShrink: 0, alignItems: 'center', borderTop: 1, borderColor: 'divider', bgcolor: 'background.paper' }}
    >
      <Stack direction="row" sx={{ alignItems: 'center' }}>
        <SmallButton title={tip('transport.toStart', 'toStart')} label={t('transport.toStart')} icon={faBackwardStep} onClick={p.onToStart} />
        {/* 再生と一時停止は 1 つのボタン（WeVocalSynth と同じ） */}
        <Tooltip title={tip(p.playing ? 'transport.pause' : 'transport.play', 'pause')}>
          <IconButton aria-label={t(p.playing ? 'transport.pause' : 'transport.play')} color="primary" size="small" onClick={p.onPause}>
            <FontAwesomeIcon icon={p.playing ? faPause : faPlay} />
          </IconButton>
        </Tooltip>
        <SmallButton title={tip('transport.stop', 'stop')} label={t('transport.stop')} icon={faStop} onClick={p.onStop} />
        <SmallButton title={tip('transport.record', 'record')} label={t('transport.record')} icon={faCircle} pressed={p.recording} color="error" onClick={p.onRecord} />
        <SmallButton title={tip('transport.repeat', 'repeat')} label={t('transport.repeat')} icon={faRepeat} pressed={p.repeat} onClick={p.onRepeat} />
        <SmallButton title={tip('transport.toEnd', 'toEnd')} label={t('transport.toEnd')} icon={faForwardStep} onClick={p.onToEnd} />
        <Typography variant="body2" sx={{ fontFamily: 'monospace', ml: 1, minWidth: 150 }}>
          <LiveTime position={p.position} playing={p.playing} livePosition={p.livePosition} duration={p.end} onSeek={p.onSeek} inputLabel={t('transport.timeInput')} />
        </Typography>
        {p.meter}
      </Stack>
      <Stack direction="row" sx={{ alignItems: 'center' }}>
        <Label>{t('transport.beatsPerBar')}</Label>
        <NumberInput value={p.tempo.beatsPerBar} min={1} max={16} step={1} width={44} unit="/4" ariaLabel={t('transport.beatsPerBar')} onChange={(n) => p.onTempo({ beatsPerBar: Math.round(n) })} />
        <Label>{t('transport.grid')} 1/</Label>
        <NumberInput value={p.division} min={GRID_MIN} max={GRID_MAX} step={1} width={52} ariaLabel={t('transport.grid')} onChange={(d) => p.onDivision(Math.round(d))} />
      </Stack>
    </Stack>
  )
}
