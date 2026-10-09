// 解析の欄（WeVocalAnalyzer のスペクトログラムと F0）。選んだ波形ブロックの音を、時間軸とそろえて下に描く
import { useEffect, useMemo, useRef, useState } from 'react'
import { Box, Typography } from '@mui/material'
import { usePalette } from 'pevenmui'
import type { Clip } from 'wevocal-lib'
import { analyzePitch, analyzeSpectrogram, renderSpectrogram, type Pitch, type Spectrogram } from 'wevocalanalyzer'
import { clipFor } from './dsp/pitch'
import type { TimelineView } from './drawTimeline'
import { useT } from './i18n'
import type { Block, Source } from './project'

const HEIGHT = 160
/** スペクトログラムの下の端の周波数（Analyzer の SPEC_MIN_HZ と同じ） */
const MIN_HZ = 50

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const noteOf = (hz: number) => {
  const m = Math.round(69 + 12 * Math.log2(hz / 440))
  return `${NOTES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`
}

/** 波形ブロックが鳴らす範囲の音（ピッチや速度を変えたものができていればそれ）と、その頭の時間軸の上の位置 */
function blockClip(b: Block, source: Source): { clip: Clip; start: number } {
  const made = clipFor(b, source)
  const clip = made ?? source.clip
  // 作った音は速度の分だけ伸び縮みしている
  const scale = made && made !== source.clip ? 1 / b.rate : 1
  const from = Math.floor(b.offset * scale * clip.sampleRate)
  const to = Math.min(clip.channels[0].length, from + Math.floor(b.length * (made ? 1 : b.rate) * clip.sampleRate))
  return { clip: { sampleRate: clip.sampleRate, channels: clip.channels.map((c) => c.subarray(from, to)) }, start: b.start }
}

export default function AnalysisPanel(p: { block: Block | null; source: Source | undefined; view: TimelineView; headerWidth: number; version: number }) {
  const t = useT()
  const { pal } = usePalette()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [width, setWidth] = useState(0)
  const [spec, setSpec] = useState<Spectrogram | null>(null)
  const [pitch, setPitch] = useState<Pitch | null>(null)
  const [busy, setBusy] = useState(false)
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null)
  const target = useMemo(() => (p.block && p.source ? blockClip(p.block, p.source) : null), [p.block, p.source, p.version])

  useEffect(() => {
    const box = canvasRef.current!.parentElement!
    const ro = new ResizeObserver(() => setWidth(box.clientWidth))
    ro.observe(box)
    return () => ro.disconnect()
  }, [])

  // 波形ブロックか、その音が変わったら解析し直す（少し待ってから。ドラッグの途中では解析しない）
  useEffect(() => {
    setSpec(null)
    setPitch(null)
    if (!target || !target.clip.channels[0].length) return
    const ac = new AbortController()
    const id = setTimeout(() => {
      setBusy(true)
      Promise.all([analyzeSpectrogram(target.clip, { signal: ac.signal }), analyzePitch(target.clip, { signal: ac.signal })])
        .then(([s, f]) => {
          setSpec(s)
          setPitch(f)
        })
        .catch(() => {})
        .finally(() => !ac.signal.aborted && setBusy(false))
    }, 300)
    return () => {
      clearTimeout(id)
      ac.abort()
    }
  }, [target])

  const maxHz = spec?.maxHz ?? 22050
  const yOfHz = (hz: number) => HEIGHT - (Math.log(hz / MIN_HZ) / Math.log(maxHz / MIN_HZ)) * HEIGHT
  const hzOfY = (y: number) => MIN_HZ * (maxHz / MIN_HZ) ** ((HEIGHT - y) / HEIGHT)

  useEffect(() => {
    const canvas = canvasRef.current!
    canvas.width = width * devicePixelRatio
    canvas.height = HEIGHT * devicePixelRatio
    const g = canvas.getContext('2d')!
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.fillStyle = '#000'
    g.fillRect(0, 0, canvas.width, canvas.height)
    if (!spec || !target || !width) return
    // 時間軸とそろえる（波形ブロックの頭からの時刻）
    const viewStart = p.view.scroll - target.start
    const viewDur = width / p.view.pps
    const img = renderSpectrogram(spec, width, HEIGHT, viewStart, viewDur)
    const tmp = new OffscreenCanvas(width, HEIGHT)
    tmp.getContext('2d')!.putImageData(img, 0, 0)
    g.drawImage(tmp, 0, 0, canvas.width, canvas.height)
    // F0 の線（声のない所は切る）
    if (pitch) {
      g.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)
      g.strokeStyle = '#4dd0e1'
      g.lineWidth = 2
      g.beginPath()
      let down = false
      for (let k = 0; k < pitch.data.length; k++) {
        const hz = pitch.data[k]
        const x = (target.start + k * pitch.hopSec - p.view.scroll) * p.view.pps
        if (!(hz > 0) || x < -2 || x > width + 2) {
          down = false
          continue
        }
        const y = yOfHz(hz)
        if (down) g.lineTo(x, y)
        else g.moveTo(x, y)
        down = true
      }
      g.stroke()
    }
  }, [spec, pitch, target, width, p.view])

  const hoverText = (() => {
    if (!hover || !spec || !target) return null
    const hz = hzOfY(hover.y)
    const time = p.view.scroll + hover.x / p.view.pps
    const k = Math.round((time - target.start) / (pitch?.hopSec ?? 0.01))
    const f0 = pitch?.data[k]
    return `${hz.toFixed(0)} Hz ${noteOf(hz)}${f0 && f0 > 0 ? `  F0 ${f0.toFixed(1)} Hz ${noteOf(f0)}` : ''}`
  })()

  return (
    <Box sx={{ display: 'flex', flexShrink: 0, borderTop: 1, borderColor: 'divider', height: HEIGHT }}>
      <Box sx={{ width: p.headerWidth, flexShrink: 0, borderRight: 1, borderColor: 'divider', p: 1, boxSizing: 'border-box', overflow: 'hidden' }}>
        <Typography variant="body2" sx={{ fontWeight: 500 }}>
          {t('analysis.title')}
        </Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }} noWrap title={p.source?.name}>
          {p.block ? p.source?.name : t('analysis.select')}
        </Typography>
        {busy && (
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {t('analysis.busy')}
          </Typography>
        )}
        {hoverText && (
          <Typography variant="caption" sx={{ color: pal.text.primary, display: 'block', mt: 1, fontFamily: 'monospace' }}>
            {hoverText}
          </Typography>
        )}
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <canvas
          ref={canvasRef}
          style={{ display: 'block', width, height: HEIGHT, cursor: 'crosshair' }}
          onPointerMove={(e) => setHover({ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY })}
          onPointerLeave={() => setHover(null)}
        />
      </Box>
    </Box>
  )
}
