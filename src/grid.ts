// 時間軸の線（拍と小節、または時間）と、スナップの寄せ先。画面を知らない
import type { Tempo } from './project'

/** 線の取り方。beats は拍と小節（REAPER の既定）、time は秒 */
export type GridMode = 'beats' | 'time'

export interface GridLine {
  t: number
  /** 小節の頭（濃く描く） */
  strong: boolean
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

/** 拍の長さ（秒）と、線を引く単位（拍、小節、何小節か）。拍が詰まりすぎるときは小節だけにする */
function beatUnit(tempo: Tempo, pps: number) {
  const beat = 60 / tempo.bpm
  const bar = beat * tempo.beatsPerBar
  if (beat * pps >= LINE_PX) return { beat, bar, step: beat }
  let step = bar
  while (step * pps < LINE_PX) step *= 2
  return { beat, bar, step }
}

/** from〜to 秒の線 */
export function gridLines(mode: GridMode, tempo: Tempo, pps: number, from: number, to: number): GridLine[] {
  const out: GridLine[] = []
  if (mode === 'time') {
    const step = timeStep(pps)
    for (let t = Math.floor(from / step) * step; t <= to; t += step) out.push({ t, strong: true, label: formatTime(t, step) })
    return out
  }
  const { beat, bar, step } = beatUnit(tempo, pps)
  // 小節の番号を書く間隔（何小節おきか）
  let every = 1
  while (bar * every * pps < LABEL_PX / 2) every *= 2
  const k0 = Math.floor((from - tempo.beatOffset) / step)
  for (let k = k0; ; k++) {
    const t = tempo.beatOffset + k * step
    if (t > to) break
    if (t < 0) continue
    const beats = Math.round((t - tempo.beatOffset) / beat)
    const strong = beats % tempo.beatsPerBar === 0
    const barNo = Math.floor(beats / tempo.beatsPerBar)
    // 拍の間が広ければ、拍にも「小節.拍」を書く
    const beatLabel = beat * pps >= LABEL_PX ? `${barNo + 1}.${(beats % tempo.beatsPerBar) + 1}` : undefined
    out.push({ t, strong, label: strong && barNo % every === 0 ? String(barNo + 1) : strong ? undefined : beatLabel })
  }
  return out
}

/** スナップで寄せる線の間隔と起点（拍が見えていれば拍、なければ線と同じ単位） */
export function snapGrid(mode: GridMode, tempo: Tempo, pps: number): { origin: number; step: number } {
  if (mode === 'time') return { origin: 0, step: timeStep(pps) }
  return { origin: tempo.beatOffset, step: beatUnit(tempo, pps).step }
}
