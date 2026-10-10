// 時間軸の線（拍と小節、または時間）と、スナップの寄せ先。画面を知らない
import { segmentAt, tempoSegments } from 'wevocal-lib'
import type { Marker, Tempo } from './project'

/** 線の取り方。beats は拍と小節、time は秒 */
export type GridMode = 'beats' | 'time'

export interface GridLine {
  t: number
  /** 小節の頭（濃く描く） */
  strong: boolean
  /** グリッドの細かい線（拍より細かい。薄く描く） */
  sub?: boolean
  /** 目盛りに書く文字（なければ書かない） */
  label?: string
}

/** 文字が重ならない広さ（px） */
const LABEL_PX = 60
/** 線が詰まりすぎない広さ（px） */
const LINE_PX = 8

/** 秒の目盛りの間隔。文字が重ならない広さにする */
function timeStep(pps: number) {
  return [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300].find((s) => s * pps >= LABEL_PX + 10) ?? 600
}

function formatTime(t: number, step: number) {
  const m = Math.floor(t / 60)
  const s = t - m * 60
  return `${m}:${step < 1 ? s.toFixed(2).padStart(5, '0') : String(Math.round(s)).padStart(2, '0')}`
}

/** グリッドの細かさ（音符。4 なら 4 分音符、16 なら 16 分音符、3 や 6 なら 3 連符。BPM は 4 分音符の速さ） */
export type GridDivision = number
export const GRID_MIN = 1
export const GRID_MAX = 256

/** 拍と小節の長さ（秒）と、線を引く単位。グリッドの 1 目盛りが詰まりすぎるときは、詰まらない所まで粗くする */
function beatUnit(bpm: number, beatsPerBar: number, pps: number, division: GridDivision) {
  const beat = 60 / bpm
  const bar = beat * beatsPerBar
  let step = beat * (4 / division)
  while (step * pps < LINE_PX) step *= 2
  return { beat, bar, step }
}

/** テンポの区間（テンポを持つマーカーの位置から変わる。WeVocalSynth と同じ wevocal-lib の tempoMap） */
const segmentsOf = (tempo: Tempo, markers: readonly Marker[]) => tempoSegments(tempo, markers)

/** from〜to 秒の線。区間の境目では、次の区間の 1 拍目から数え直す（小節の番号は続けて数える） */
export function gridLines(mode: GridMode, tempo: Tempo, pps: number, from: number, to: number, division: GridDivision = 4, markers: readonly Marker[] = []): GridLine[] {
  const out: GridLine[] = []
  if (mode === 'time') {
    const step = timeStep(pps)
    for (let t = Math.floor(from / step) * step; t <= to; t += step) out.push({ t, strong: true, label: formatTime(t, step) })
    return out
  }
  const segs = segmentsOf(tempo, markers)
  for (const [i, sg] of segs.entries()) {
    const end = segs[i + 1]?.start ?? Infinity
    const a = Math.max(from, sg.start, 0)
    const b = Math.min(to, end)
    if (a > b) continue
    const { beat, bar, step } = beatUnit(sg.bpm, sg.beatsPerBar, pps, division)
    // 小節の番号を書く間隔（何小節おきか）
    let every = 1
    while (bar * every * pps < LABEL_PX / 2) every *= 2
    for (let k = Math.ceil((a - sg.offset) / step - 1e-9); ; k++) {
      const t = sg.offset + k * step
      if (t > b + 1e-9 || t >= end - 1e-9) break
      const exact = (t - sg.offset) / beat
      const beats = Math.round(exact)
      // 拍の上にない線は、グリッドの細かい線
      if (Math.abs(exact - beats) > 1e-6) {
        out.push({ t, strong: false, sub: true })
        continue
      }
      const inBar = ((beats % sg.beatsPerBar) + sg.beatsPerBar) % sg.beatsPerBar
      const strong = inBar === 0
      const barNo = sg.firstBar + Math.floor(beats / sg.beatsPerBar)
      // 拍の間が広ければ、拍にも「小節.拍」を書く
      const beatLabel = beat * pps >= LABEL_PX ? `${barNo}.${inBar + 1}` : undefined
      out.push({ t, strong, label: strong && (barNo - 1) % every === 0 ? String(barNo) : strong ? undefined : beatLabel })
    }
  }
  return out
}

/** スナップで寄せる線の間隔と起点（at 秒の区間の。拍が見えていれば拍、なければ線と同じ単位） */
export function snapGrid(mode: GridMode, tempo: Tempo, pps: number, division: GridDivision = 4, markers: readonly Marker[] = [], at = 0): { origin: number; step: number } {
  if (mode === 'time') return { origin: 0, step: timeStep(pps) }
  const sg = segmentAt(segmentsOf(tempo, markers), at)
  if (!sg) return { origin: tempo.beatOffset, step: beatUnit(tempo.bpm, tempo.beatsPerBar, pps, division).step }
  return { origin: sg.offset, step: beatUnit(sg.bpm, sg.beatsPerBar, pps, division).step }
}
