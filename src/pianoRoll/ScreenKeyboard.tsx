// 画面の鍵盤（2 オクターブ。押している間鳴る。MIDI キーボードがない端末と、ステップ入力で使う）。左右のボタンで 1 オクターブずつずらす
import { useRef } from 'react'
import { Box, Button, FormControlLabel, Switch, Typography } from '@mui/material'
import { pevenFont } from 'pevenmui'
import { useT } from '../i18n'
import { BLACK, NAMES } from './view'

/** 見せる白鍵の数（2 オクターブ）と、1 オクターブの白鍵の半音の位置 */
const WHITE = [0, 2, 4, 5, 7, 9, 11]
const OCTAVES = 2

export default function ScreenKeyboard(p: {
  /** 一番左の C の高さ（12 の倍数） */
  base: number
  onBase: (base: number) => void
  onNote: (pitch: number, vel: number, on: boolean) => void
  stepOn: boolean
  onStep: (on: boolean) => void
  onRest: () => void
}) {
  const t = useT()
  // 指ごとに押している鍵盤（離したときに、同じ音を止める）
  const down = useRef(new Map<number, number>())
  const press = (e: React.PointerEvent, pitch: number) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    down.current.set(e.pointerId, pitch)
    p.onNote(pitch, 0.8, true)
  }
  const release = (e: React.PointerEvent) => {
    const pitch = down.current.get(e.pointerId)
    if (pitch === undefined) return
    down.current.delete(e.pointerId)
    p.onNote(pitch, 0, false)
  }
  const whites = Array.from({ length: OCTAVES * 7 }, (_, i) => p.base + Math.floor(i / 7) * 12 + WHITE[i % 7])
  const w = 100 / whites.length
  const keyProps = (pitch: number) => ({ onPointerDown: (e: React.PointerEvent) => press(e, pitch), onPointerUp: release, onPointerCancel: release })
  return (
    <Box sx={{ display: 'flex', alignItems: 'stretch', gap: 1, px: 1.5, py: 0.5, borderTop: 1, borderColor: 'divider', flexShrink: 0 }}>
      <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 0.5, width: 112, flexShrink: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Button size="small" sx={{ minWidth: 28 }} disabled={p.base <= 0} onClick={() => p.onBase(p.base - 12)}>
            ◀
          </Button>
          <Typography sx={{ fontSize: pevenFont('sm'), flex: 1, textAlign: 'center' }}>{`${NAMES[0]}${Math.floor(p.base / 12) - 1}`}</Typography>
          <Button size="small" sx={{ minWidth: 28 }} disabled={p.base + OCTAVES * 12 > 120} onClick={() => p.onBase(p.base + 12)}>
            ▶
          </Button>
        </Box>
        <FormControlLabel control={<Switch size="small" checked={p.stepOn} onChange={(e) => p.onStep(e.target.checked)} />} label={<Typography sx={{ fontSize: pevenFont('sm') }}>{t('roll.stepInput')}</Typography>} sx={{ m: 0 }} />
        {p.stepOn && (
          <Button size="small" onClick={p.onRest}>
            {t('roll.rest')}
          </Button>
        )}
      </Box>
      <Box sx={{ position: 'relative', flex: 1, height: 72, userSelect: 'none', touchAction: 'none' }}>
        {whites.map((pitch, i) => (
          <Box key={pitch} {...keyProps(pitch)} sx={{ position: 'absolute', top: 0, bottom: 0, left: `${i * w}%`, width: `${w}%`, bgcolor: '#e9e9e9', border: '1px solid #9a9a9a', boxSizing: 'border-box', borderRadius: '0 0 3px 3px', '&:active': { bgcolor: 'primary.light' } }}>
            {pitch % 12 === 0 && <Typography sx={{ position: 'absolute', bottom: 2, left: 0, right: 0, textAlign: 'center', fontSize: 10, color: '#2b2b2b' }}>{`C${Math.floor(pitch / 12) - 1}`}</Typography>}
          </Box>
        ))}
        {whites.slice(0, -1).flatMap((pitch, i) => (BLACK.has((pitch + 1) % 12) ? [pitch + 1] : []).map((bp) => (
          <Box key={bp} {...keyProps(bp)} sx={{ position: 'absolute', top: 0, height: '62%', left: `${(i + 1) * w - w * 0.3}%`, width: `${w * 0.6}%`, bgcolor: '#2b2b2b', borderRadius: '0 0 3px 3px', zIndex: 1, '&:active': { bgcolor: 'primary.main' } }} />
        )))}
      </Box>
    </Box>
  )
}
