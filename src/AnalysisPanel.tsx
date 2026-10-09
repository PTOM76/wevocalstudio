// 解析の欄（WeVocalAnalyzer のスペクトログラムと F0）。選んだ波形ブロックの音を、時間軸とそろえて下に描く。ペンでピッチカーブを描く
import { useEffect, useMemo, useRef, useState } from 'react'
import { Box, ToggleButton, Typography } from '@mui/material'
import { usePalette } from 'pevenmui'
import type { Clip } from 'wevocal-lib'
import { analyzePitch, analyzeSpectrogram, renderSpectrogram, type Pitch, type Spectrogram } from 'wevocalanalyzer'
import { clipFor } from './dsp/pitch'
import type { TimelineView } from './drawTimeline'
import { useT } from './i18n'
import { CURVE_HOP, type Block, type PitchCurve, type Source } from './project'

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

/** 元の音（ピッチを変える前）の、波形ブロックが使う範囲 */
function sourceSpan(b: Block, source: Source): Clip {
  const { clip } = source
  const from = Math.floor(b.offset * clip.sampleRate)
  const to = Math.min(clip.channels[0].length, from + Math.ceil(b.length * b.rate * clip.sampleRate))
  return { sampleRate: clip.sampleRate, channels: clip.channels.map((c) => c.subarray(from, to)) }
}

/** カーブの index 番目に値を入れる。足りなければ前後を 0 で広げる */
function putCurve(c: PitchCurve, at: number, v: number): PitchCurve {
  let { from, st } = c
  let i = Math.round((at - from) / CURVE_HOP)
  if (i < 0) {
    st = [...new Array(-i).fill(0), ...st]
    from -= -i * CURVE_HOP
    i = 0
  }
  if (i >= st.length) st = [...st, ...new Array(i - st.length + 1).fill(0)]
  else st = [...st]
  st[i] = v
  return { from, st }
}

export default function AnalysisPanel(p: {
  block: Block | null
  source: Source | undefined
  view: TimelineView
  headerWidth: number
  version: number
  /** ペンで描いたカーブ（merge は続けて描く間の履歴のまとまり） */
  onCurve: (curve: PitchCurve | undefined, merge: string) => void
  onEndMerge: () => void
}) {
  const t = useT()
  const { pal } = usePalette()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [width, setWidth] = useState(0)
  const [spec, setSpec] = useState<Spectrogram | null>(null)
  const [pitch, setPitch] = useState<Pitch | null>(null)
  const [busy, setBusy] = useState(false)
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null)
  const [pen, setPen] = useState(false)
  // 元の音の F0（ペンで描くときの基準）
  const [orig, setOrig] = useState<Pitch | null>(null)
  const drawing = useRef<{ last: { s: number; v: number } | null; merge: string; curve: PitchCurve } | null>(null)
  const strokes = useRef(0)
  const target = useMemo(() => (p.block && p.source ? blockClip(p.block, p.source) : null), [p.block, p.source, p.version])

  useEffect(() => {
    const box = canvasRef.current!.parentElement!
    const ro = new ResizeObserver(() => setWidth(box.clientWidth))
    ro.observe(box)
    return () => ro.disconnect()
  }, [])

  // 元の音の F0 は、使う範囲が変わったときだけ解析する
  const spanKey = p.block && p.source ? `${p.source.id}|${p.block.offset}|${p.block.length}|${p.block.rate}` : ''
  useEffect(() => {
    setOrig(null)
    if (!p.block || !p.source) return
    const ac = new AbortController()
    analyzePitch(sourceSpan(p.block, p.source), { signal: ac.signal }).then(setOrig, () => {})
    return () => ac.abort()
    // 範囲（spanKey）が変わったときだけ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spanKey])

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
    // 元の音の F0（薄い線）。時刻は元の音の上なので、速度で割って時間軸に置く
    if (orig && p.block) {
      const b = p.block
      g.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)
      g.strokeStyle = 'rgba(255,255,255,0.45)'
      g.lineWidth = 1
      g.beginPath()
      let down = false
      for (let k = 0; k < orig.data.length; k++) {
        const hz = orig.data[k]
        const x = (b.start + (k * orig.hopSec) / b.rate - p.view.scroll) * p.view.pps
        if (!(hz > 0) || x < -2 || x > width + 2) {
          down = false
          continue
        }
        if (down) g.lineTo(x, yOfHz(hz))
        else g.moveTo(x, yOfHz(hz))
        down = true
      }
      g.stroke()
    }
    // 変えたあとの F0 の線（声のない所は切る）
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
  }, [spec, pitch, orig, target, width, p.view, p.block])

  /** ペン: 押した所の高さになるようにカーブを書く（元の F0 との差を半音で）。Alt で元に戻す（0） */
  const drawAt = (x: number, y: number, erase: boolean) => {
    const d = drawing.current
    const b = p.block
    if (!d || !b || !orig) return
    const t = p.view.scroll + x / p.view.pps
    // 元の音の上の時刻
    const s = b.offset + (t - b.start) * b.rate
    const k = Math.round((s - b.offset) / orig.hopSec)
    const base = orig.data[k]
    if (!erase && !(base > 0)) return
    const v = erase ? 0 : 12 * Math.log2(hzOfY(y) / base) - b.pitch
    // 前の点との間を直線で埋める（速く動かして飛ばした所）
    let curve = d.curve
    const from = d.last ?? { s, v }
    const steps = Math.max(1, Math.round(Math.abs(s - from.s) / CURVE_HOP))
    for (let i = 0; i <= steps; i++) curve = putCurve(curve, from.s + ((s - from.s) * i) / steps, from.v + ((v - from.v) * i) / steps)
    d.curve = curve
    d.last = { s, v }
    p.onCurve(curve, d.merge)
  }

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
        <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5 }}>
          <ToggleButton size="small" value="pen" selected={pen} disabled={!p.block} onChange={() => setPen(!pen)} sx={{ py: 0, px: 1, fontSize: 12 }} title={t('analysis.penHelp')}>
            {t('analysis.pen')}
          </ToggleButton>
          <ToggleButton size="small" value="clear" disabled={!p.block?.curve} onChange={() => p.onCurve(undefined, `clear${strokes.current++}`)} sx={{ py: 0, px: 1, fontSize: 12 }}>
            {t('analysis.clearCurve')}
          </ToggleButton>
        </Box>
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
          style={{ display: 'block', width, height: HEIGHT, cursor: pen ? 'crosshair' : 'default', touchAction: 'none' }}
          onPointerDown={(e) => {
            if (!pen || !p.block) return
            e.currentTarget.setPointerCapture(e.pointerId)
            drawing.current = { last: null, merge: `curve${strokes.current++}`, curve: p.block.curve ?? { from: p.block.offset, st: [] } }
            drawAt(e.nativeEvent.offsetX, e.nativeEvent.offsetY, e.altKey)
          }}
          onPointerUp={() => {
            drawing.current = null
            p.onEndMerge()
          }}
          onPointerMove={(e) => {
            setHover({ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY })
            if (drawing.current) drawAt(e.nativeEvent.offsetX, e.nativeEvent.offsetY, e.altKey)
          }}
          onPointerLeave={() => setHover(null)}
        />
      </Box>
    </Box>
  )
}
