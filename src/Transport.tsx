// 再生のボタン一式（先頭へ、停止、再生と一時停止、録音、リピート、末尾へ）、時間の表示、マスターのメーター、テンポとグリッド。部品は WeVocalSynth のツールバーと同じ
import type { ReactNode } from 'react'
import { IconButton, Stack, Tooltip, Typography } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faBackwardStep, faCircle, faForwardStep, faPause, faPlay, faRepeat, faStop } from '@fortawesome/free-solid-svg-icons'
import { InlineEdit, LiveTime, OverflowRow, SmallButton, ToolbarDivider, pevenFont } from 'pevenmui'
import { useT, type MessageKey } from './i18n'
import { keyLabel, type Action } from './keymap'
import type { Tempo } from './project'
import { GRID_MAX, GRID_MIN, type GridDivision } from './grid'

export { formatTime } from 'pevenmui'

/** 数の欄の前の小さな名前 */
const Label = ({ children }: { children: ReactNode }) => (
  <Typography component="span" sx={{ fontSize: pevenFont('sm'), color: 'text.secondary', mr: 0.75 }}>
    {children}
  </Typography>
)

/** 打った文字を範囲内の整数にして渡す。読めなければ false（入力を続ける） */
function commitInt(text: string, min: number, max: number, set: (n: number) => void) {
  const n = Math.round(Number(text.replace(/^1\//, '').replace(/\/4$/, '')))
  if (!Number.isFinite(n) || n < min || n > max) return false
  set(n)
  return true
}

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
      </Stack>
      {/* メーター、拍子、グリッドは、入りきらなければ後ろから ▼ の中に入れる（WeVocalSynth のツールバーと同じ。再生まわりは常に出す） */}
      <OverflowRow>
        {p.meter}
        {/* 拍子とグリッド。再生位置と同じく、ふだんは文字で、押すとその場で入力できる */}
        <Typography variant="body2" sx={{ fontFamily: 'monospace', px: 1 }}>
          <Label>{t('transport.beatsPerBar')}</Label>
          <InlineEdit
            text={`${p.tempo.beatsPerBar}/4`}
            draftOf={() => String(p.tempo.beatsPerBar)}
            width="3ch"
            label={t('transport.beatsPerBar')}
            onCommit={(v) => commitInt(v, 1, 16, (beatsPerBar) => p.onTempo({ beatsPerBar }))}
          />
        </Typography>
        <Typography variant="body2" sx={{ fontFamily: 'monospace', px: 1 }}>
          <Label>{t('transport.grid')}</Label>
          <InlineEdit text={`1/${p.division}`} draftOf={() => String(p.division)} width="4ch" label={t('transport.grid')} onCommit={(v) => commitInt(v, GRID_MIN, GRID_MAX, p.onDivision)} />
        </Typography>
      </OverflowRow>
    </Stack>
  )
}
