// 秒と拍（4 分音符 = 1）の変換。テンポの区間（マーカーで変わる）をたどる。MIDI ブロックの音符は拍で持ち、鳴らすときと描くときに秒へ直す。画面を知らない
import { tempoSegments } from 'wevocal-lib'
import type { Marker, Tempo } from './project'

export interface BeatMap {
  /** 秒 → 拍（1 拍目の位置 beatOffset を 0 拍とする通しの拍） */
  toBeat: (sec: number) => number
  /** 拍 → 秒 */
  toSec: (beat: number) => number
}

/** テンポの区間ごとに、始まりの位置（秒）と通しの拍をたどる変換 */
export function beatMap(tempo: Tempo, markers: readonly Marker[]): BeatMap {
  const segs = tempoSegments(tempo, markers)
  // 区間の始まり（先頭は 1 拍目の位置。次の区間より後ろなら次の始まりに寄せる）と、そこでの通しの拍
  const origin = segs.map((s, i) => (i === 0 ? Math.min(s.offset, segs[1]?.start ?? Infinity) : s.start))
  const base: number[] = []
  segs.forEach((_, i) => base.push(i === 0 ? 0 : base[i - 1] + ((origin[i] - origin[i - 1]) * segs[i - 1].bpm) / 60))
  const toBeat = (sec: number) => {
    let i = 0
    while (i + 1 < segs.length && segs[i + 1].start <= sec) i++
    return base[i] + ((sec - origin[i]) * segs[i].bpm) / 60
  }
  const toSec = (beat: number) => {
    let i = 0
    while (i + 1 < segs.length && base[i + 1] <= beat) i++
    return origin[i] + ((beat - base[i]) * 60) / segs[i].bpm
  }
  return { toBeat, toSec }
}

/** プロジェクトのテンポの地図 */
export const projectBeatMap = (p: { tempo: Tempo; markers: readonly Marker[] }) => beatMap(p.tempo, p.markers)

/** MIDI ブロックの長さ（拍） */
export const blockBeats = (map: BeatMap, b: { start: number; length: number }) => map.toBeat(b.start + b.length) - map.toBeat(b.start)
