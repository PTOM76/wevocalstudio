// 時間軸の描画（目盛り、トラックの区切り、波形ブロック、再生位置）
import { alpha, type Range } from 'wevocal-lib'
import { gridLines, type GridDivision, type GridMode } from './grid'
import { drawLanes } from './autoLane'
import { drawMidiBlocks } from './midiBlocks'
import { ENVELOPES, denseEnv, type EnvKind } from './envelopes'
import { layoutRows } from './overlap'
import { peakRange } from './peaks'
import { blockReady } from './dsp/pitch'
import { bakedTracks, ENV_MAX, masterHeight, ownAudible, trackHeight, type Block, type PitchEnvelopeRange, type Project, type Source, type VolumeEnvelopeRange } from './project'

export const RULER = 24
/** トラックの行が始まる位置（目盛りとマスタートラックの行の下） */
export const topOf = (p: Project) => RULER + masterHeight(p.master)
export const LANE = 96
/** トラックの並びごとの、各行の上端（tops[i] は i 番目の上端。トラックは書き換えずに作り直すので、並びの配列が同じなら同じ値） */
const topsCache = new WeakMap<Project['tracks'], number[]>()
export function trackTop(p: Project, index: number) {
  let tops = topsCache.get(p.tracks)
  if (!tops || tops[0] !== topOf(p)) {
    tops = [topOf(p)]
    for (const t of p.tracks) tops.push(tops[tops.length - 1] + trackHeight(t))
    topsCache.set(p.tracks, tops)
  }
  return tops[Math.max(0, Math.min(index, tops.length - 1))]
}
export const totalTrackHeight = (p: Project) => p.tracks.reduce((sum, t) => sum + trackHeight(t), 0)

export interface TimelineView {
  /** 左端の時刻（秒） */
  scroll: number
  /** 1 秒の幅（px） */
  pps: number
}

/** 線の取り方とテンポ以外に描くときに使うもの */
export interface DrawOptions {
  grid: GridMode
  division: GridDivision
  /** 作り直している波形ブロックに出す文字 */
  pendingLabel: string
  /** 音量のエンベロープを描く */
  /** 出すエンベロープ（音量かピッチ。出さなければ null） */
  envKind: EnvKind | null
  envelopeRange: VolumeEnvelopeRange
  pitchEnvelopeRange: PitchEnvelopeRange
  /** オートメーションを編集している（レーンの点を出す） */
  autoEdit: boolean
  /** 縦のスクロール量（px。トラックの行だけをずらす。目盛りとマスターは固定） */
  vscroll: number
  /** トラックの名前を行の左下に重ねる（トラックの欄を閉じているとき） */
  trackNames: boolean
}

export interface TimelineColors {
  bg: string
  lane: string
  line: string
  text: string
  block: string
  blockSelected: string
  wave: string
  playhead: string
  /** 編集カーソル（再生カーソルとは別の線） */
  editCursor: string
  /** マスタートラックの帯の色 */
  master: string
  /** マーカーの色 */
  marker: string
  /** 範囲選択の色 */
  range: string
}

/** 波形ブロックの中に元の音の波形を描く（1 列ごとの最小と最大） */
function drawBlockWave(g: CanvasRenderingContext2D, b: Block, source: Source | undefined, x: number, y: number, w: number, h: number, width: number) {
  if (!source) return
  const { clip } = source
  const mid = y + h / 2
  const perPx = (b.length * b.rate * clip.sampleRate) / w
  const amp = (h / 2) * Math.min(4, 10 ** (b.gain / 20))
  // ピークは元の音ごとに前もって作ったものを使う（peaks.ts）。列ごとの四角は 1 つのパスにまとめて 1 回で塗る
  const pk = { lo: 0, hi: 0 }
  g.beginPath()
  for (let px = Math.max(0, Math.floor(x)); px < Math.min(width, Math.ceil(x + w)); px++) {
    const a = Math.floor(b.offset * clip.sampleRate + (px - x) * perPx)
    peakRange(clip, a, Math.floor(a + perPx) + 1, perPx, pk)
    g.rect(px, mid - pk.hi * amp, 1, Math.max(1, (pk.hi - pk.lo) * amp))
  }
  g.fill()
}

export function drawTimeline(canvas: HTMLCanvasElement, p: Project, view: TimelineView, selected: string[], range: Range | null, o: DrawOptions, c: TimelineColors) {
  const g = canvas.getContext('2d')!
  const w = canvas.width / devicePixelRatio
  const h = canvas.height / devicePixelRatio
  g.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)
  g.fillStyle = c.bg
  g.fillRect(0, 0, w, h)
  const tx = (t: number) => (t - view.scroll) * view.pps

  // 目盛りと線（拍と小節か、秒）。小節の頭は濃く描く
  g.font = '11px Roboto, sans-serif'
  g.textBaseline = 'middle'
  for (const line of gridLines(o.grid, p.tempo, view.pps, view.scroll, view.scroll + w / view.pps, o.division, p.markers)) {
    const x = Math.round(tx(line.t)) + 0.5
    g.fillStyle = line.strong ? c.lane : c.line
    // グリッドの細かい線は薄く
    g.globalAlpha = line.sub ? 0.45 : 1
    g.fillRect(x, line.label ? RULER - 8 : RULER - 4, 1, h)
    g.globalAlpha = 1
    if (line.label) {
      // 数字は Synth の目盛りと同じく、少し控えめな色で、線の上に置く
      g.fillStyle = c.text
      g.globalAlpha = 0.8
      g.fillText(line.label, x + 3, RULER / 2 - 2)
      g.globalAlpha = 1
    }
  }
  // 目盛りの下の線（Synth の目盛りと同じ）
  g.fillStyle = c.line
  g.fillRect(0, RULER - 1, w, 1)

  // マスタートラックの帯（波形ブロックは置かない）
  g.fillStyle = c.master
  const TOP = topOf(p)
  g.fillRect(0, RULER, w, TOP - RULER)
  g.fillStyle = c.lane
  g.fillRect(0, TOP - 1, w, 1)

  // トラックと波形ブロック。重なったものは段に分ける。目盛りとマスターの下だけに描く（縦にスクロールしても上は固定）
  g.save()
  g.beginPath()
  g.rect(0, TOP, w, h - TOP)
  g.clip()
  const slots = layoutRows(p.blocks)
  // 元の音とトラックごとの波形ブロックは、描く前に一度だけ引けるようにする（波形ブロックごとに全体を探さない）
  const sources = new Map(p.sources.map((s) => [s.id, s]))
  const byTrack = new Map<string, Block[]>()
  for (const b of p.blocks) {
    const list = byTrack.get(b.track)
    if (list) list.push(b)
    else byTrack.set(b.track, [b])
  }
  const selectedSet = new Set(selected)
  // フリーズしたトラックとそのサブトラック（編集できない）
  const baked = bakedTracks(p)
  p.tracks.forEach((track, i) => {
    const laneH = trackHeight(track)
    const laneY = trackTop(p, i) - o.vscroll
    if (laneY > h || laneY + laneH < TOP) return
    g.fillStyle = c.lane
    g.fillRect(0, laneY + laneH - 1, w, 1)
    const audible = ownAudible(p, track)
    for (const b of byTrack.get(track.id) ?? []) {
      const source = sources.get(b.source)
      const slot = slots.get(b.id) ?? { row: 0, rows: 1 }
      const H = laneH / slot.rows
      const y = laneY + slot.row * H
      const x = tx(b.start)
      const bw = b.length * view.pps
      if (x > w || x + bw < 0) continue
      // 鳴らないトラック（ミュート、ほかのソロ）と、ミュートした波形ブロックは薄く出す（WeVocalSynth と同じ）。フリーズ中のトラックも少し薄くする（編集できない）
      g.globalAlpha = b.mute || !audible ? 0.35 : baked.has(track.id) ? 0.6 : 1
      g.fillStyle = selectedSet.has(b.id) ? c.blockSelected : c.block
      g.fillRect(x, y + 2, bw, H - 5)
      g.fillStyle = c.wave
      // 低い段では名前の行を省いて波形だけにする
      const label = H >= 40
      drawBlockWave(g, b, source, x, y + (label ? 16 : 3), bw, H - (label ? 20 : 6), w)
      // フェード
      g.strokeStyle = c.text
      g.beginPath()
      if (b.fadeIn > 0) {
        g.moveTo(x, y + H - 3)
        g.lineTo(x + b.fadeIn * view.pps, y + 2)
      }
      if (b.fadeOut > 0) {
        g.moveTo(x + bw - b.fadeOut * view.pps, y + 2)
        g.lineTo(x + bw, y + H - 3)
      }
      g.stroke()
      // 名前とピッチ、音量
      const name = b.name?.trim() || source?.name || ''
      const sign = (v: number) => (v > 0 ? `+${v}` : `${v}`)
      const info = [b.pitch ? sign(b.pitch) : '', b.rate !== 1 ? `×${+b.rate.toFixed(3)}` : '', b.formant ? `F${sign(b.formant)}` : '', b.gain ? `${sign(b.gain)} dB` : ''].filter(Boolean).join('  ')
      if (label) {
        g.save()
        g.beginPath()
        g.rect(x, y, bw, H)
        g.clip()
        g.fillStyle = c.text
        g.fillText(`${name}  ${info}`, Math.max(x + 4, 4), y + 9)
        g.restore()
      }
      // エンベロープ（音量は橙、ピッチは水色の線と点。無ければ 0 の線）
      if (o.envKind) {
        const top = y + 2
        const eh = H - 5
        const spec = ENVELOPES[o.envKind]
        const pts = spec.points(b)
        const env = pts.length ? pts : [{ t: 0, v: spec.zero }]
        const range = spec.defaultRange(b, o.envKind === 'pitch' ? o.pitchEnvelopeRange : o.envelopeRange)
        const color = o.envKind === 'pitch' ? '#29b6f6' : '#ff9800'
        if (o.envKind === 'pitch') {
          const step = range <= 6 ? 1 : 3
          g.save()
          g.beginPath()
          g.rect(x, top, bw, eh)
          g.clip()
          g.font = '9px sans-serif'
          g.textBaseline = 'middle'
          for (let st = -range; st <= range; st += step) {
            const gy = top + spec.y(st, range) * eh
            g.strokeStyle = st === 0 ? alpha(color, 0.55) : alpha(color, 0.2)
            g.lineWidth = st === 0 ? 1 : 0.5
            g.beginPath()
            g.moveTo(x, gy)
            g.lineTo(x + bw, gy)
            g.stroke()
            g.fillStyle = alpha(color, 0.8)
            g.fillText(st > 0 ? `+${st}` : `${st}`, x + 3, gy - 5)
          }
          g.restore()
        } else {
          const volumeMarks = [-range, -range / 2, 0, ENV_MAX]
          g.save()
          g.beginPath()
          g.rect(x, top, bw, eh)
          g.clip()
          g.font = '9px sans-serif'
          g.textBaseline = 'middle'
          for (const db of volumeMarks) {
            const gy = top + spec.y(db, range) * eh
            g.strokeStyle = db === 0 ? alpha(color, 0.55) : alpha(color, 0.2)
            g.lineWidth = db === 0 ? 1 : 0.5
            g.beginPath()
            g.moveTo(x, gy)
            g.lineTo(x + bw, gy)
            g.stroke()
            g.fillStyle = alpha(color, 0.8)
            g.fillText(`${db > 0 ? '+' : ''}${db}`, x + 3, gy - 5)
          }
          g.restore()
        }
        g.save()
        g.beginPath()
        g.rect(x, top, bw, eh)
        g.clip()
        g.strokeStyle = color
        g.lineWidth = 1.5
        g.beginPath()
        g.moveTo(x, top + spec.y(env[0].v, range) * eh)
        for (const pt of denseEnv(env)) g.lineTo(x + pt.t * view.pps, top + spec.y(pt.v, range) * eh)
        g.lineTo(x + bw, top + spec.y(env[env.length - 1].v, range) * eh)
        g.stroke()
        g.fillStyle = color
        for (const pt of pts) g.fillRect(x + pt.t * view.pps - 3, top + spec.y(pt.v, range) * eh - 3, 6, 6)
        g.restore()
      }
      // 作り直している波形ブロックは斜線と「処理中 n%」（できた所から鳴る）
      const ready = blockReady(b)
      if (ready < 1) {
        g.save()
        g.beginPath()
        g.rect(x, y + 2, bw, H - 5)
        g.clip()
        g.strokeStyle = alpha(c.text, 0.25)
        g.lineWidth = 1
        g.beginPath()
        for (let sx = Math.floor(x / 8) * 8 - H; sx < x + bw; sx += 8) {
          g.moveTo(sx, y + H)
          g.lineTo(sx + H, y)
        }
        g.stroke()
        g.fillStyle = c.text
        g.fillText(`${o.pendingLabel} ${Math.floor(ready * 100)}%`, x + 4, y + H - 10)
        g.restore()
      }
      g.globalAlpha = 1
    }
    // MIDI ブロック（音符を小さな帯で見せる）
    drawMidiBlocks(g, p, track.id, view.scroll, view.pps, o.vscroll, w, selected, { block: c.block, blockSelected: c.blockSelected, note: c.wave, text: c.text })
    // トラックの欄を閉じているときは、トラックの名前を行の左下に重ねる
    if (o.trackNames) {
      g.font = '11px sans-serif'
      g.textBaseline = 'top'
      const tw = Math.min(w / 2, g.measureText(track.name).width + 8)
      g.fillStyle = c.bg
      g.globalAlpha = 0.75
      g.fillRect(0, laneY + laneH - 17, tw, 16)
      g.globalAlpha = 1
      g.fillStyle = c.text
      g.fillText(track.name, 4, laneY + laneH - 15, tw - 6)
    }
  })
  g.restore()

  // オートメーションのレーン（トラックとマスターに重ねる折れ線）
  drawLanes(g, p, view.scroll, view.pps, w, o.vscroll, o.autoEdit)

  // 範囲選択（全トラックにかかる）
  if (range) {
    g.fillStyle = c.range
    g.fillRect(tx(range.start), 0, (range.end - range.start) * view.pps, h)
  }

  // マーカー（目盛りの上に旗と名前、全トラックに細い線）
  for (const m of p.markers) {
    const x = Math.round(tx(m.time)) + 0.5
    if (x < -100 || x > w) continue
    g.fillStyle = c.marker
    g.globalAlpha = 0.5
    g.fillRect(x, RULER, 1, h)
    g.globalAlpha = 1
    // テンポを変えるマーカーは、名前の後ろにテンポを出す
    const label = m.tempo ? `${m.name} ♩=${m.tempo.bpm} ${m.tempo.beatsPerBar}/4` : m.name
    const lw = g.measureText(label).width + 8
    g.fillRect(x, 0, lw, 12)
    g.fillStyle = '#000'
    g.fillText(label, x + 4, 6)
  }

  // 曲の終わり（最後の波形ブロックの終わり。再生はここで止まる）
  const last = p.blocks.reduce((m, b) => Math.max(m, b.start + b.length), 0)
  if (last > 0) {
    g.fillStyle = c.text
    g.globalAlpha = 0.5
    g.fillRect(Math.round(tx(last)), RULER, 2, h)
    g.globalAlpha = 1
  }

}

/** 録音中の波形ブロックの描き方（y と h はトラックの行、bars は録り始めからの秒と、その時の振幅） */
export interface LiveBlock {
  start: number
  seconds: number
  y: number
  h: number
  bars: readonly (readonly [number, number])[]
  fill: string
  wave: string
}

/** 上に重ねた canvas に、編集カーソル（上に小さな三角）と再生カーソルだけを描く（再生中は毎フレームこれだけを描き直す。WeVocalSynth と同じ） */
export function drawCursors(canvas: HTMLCanvasElement, TOP: number, view: TimelineView, cursor: number, playPos: number | null, c: { editCursor: string; playhead: string }, live?: LiveBlock | null) {
  const g = canvas.getContext('2d')!
  const w = canvas.width / devicePixelRatio
  const h = canvas.height / devicePixelRatio
  g.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)
  g.clearRect(0, 0, w, h)
  const tx = (t: number) => (t - view.scroll) * view.pps
  if (live) {
    // 録音中の波形ブロック（録った分だけ右へ伸びる）。マスターと目盛りの上にははみ出さない
    g.save()
    g.beginPath()
    g.rect(0, TOP, w, h - TOP)
    g.clip()
    const x = tx(live.start)
    g.fillStyle = live.fill
    g.fillRect(x, live.y + 2, Math.max(1, live.seconds * view.pps), live.h - 5)
    g.fillStyle = live.wave
    const mid = live.y + live.h / 2
    const amp = (live.h - 9) / 2
    for (const [t, peak] of live.bars) {
      const bx = tx(live.start + t)
      if (bx < -1 || bx > w) continue
      const a = Math.max(1, Math.min(1, peak) * amp)
      g.fillRect(bx, mid - a, 1, a * 2)
    }
    g.restore()
  }
  const ex = Math.round(tx(cursor))
  g.fillStyle = c.editCursor
  g.fillRect(ex, 0, 1, h)
  g.beginPath()
  g.moveTo(ex - 5, 0)
  g.lineTo(ex + 6, 0)
  g.lineTo(ex + 0.5, 7)
  g.fill()
  if (playPos !== null) {
    g.fillStyle = c.playhead
    g.fillRect(Math.round(tx(playPos)), 0, 2, h)
  }
}
