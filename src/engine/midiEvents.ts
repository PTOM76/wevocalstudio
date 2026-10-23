// MIDI ブロックの音符とコントロールを、音源へ渡す形（AudioContext の時刻）に並べる純粋な関数。zero は曲の 0 秒が AudioContext の何秒か
import { blockBeats, projectBeatMap } from '../beats'
import { curveSteps } from '../midiCurves'
import { playedNotes, playedPoints } from '../midiLoop'
import { midiBlocks, ownAudible, type Project } from '../project'
import type { ControlEvent, NoteEvent } from 'wevocal-lib'

/** そのトラックの音符を、AudioContext の時刻にして並べる（曲の時刻が [from, to) に始まるもの） */
export function noteEvents(p: Project, track: string, from: number, to: number, zero: number): NoteEvent[] {
  const out: NoteEvent[] = []
  const tr = p.tracks.find((t) => t.id === track)
  const own = !!tr && ownAudible(p, tr)
  const map = projectBeatMap(p)
  for (const b of midiBlocks(p)) {
    if (b.track !== track || b.mute || !own) continue
    const b0 = map.toBeat(b.start)
    const len = blockBeats(map, b)
    // ループがあれば繰り返し、ブロックの外にはみ出した音符は、ブロックの終わり（とループの終わり）で切る
    for (const pn of playedNotes(b, len)) {
      if (pn.note.mute) continue
      const t = map.toSec(b0 + pn.t)
      const dur = map.toSec(b0 + pn.t + pn.dur) - t
      if (t >= from && t < to && dur > 0) out.push({ time: zero + t, dur, pitch: pn.note.pitch, vel: pn.note.vel })
    }
  }
  return out.sort((a, b) => a.time - b.time)
}

/** そのトラックのコントロール（CC、ピッチベンド）を、AudioContext の時刻にして並べる（noteEvents と同じ範囲） */
export function controlEvents(p: Project, track: string, from: number, to: number, zero: number): ControlEvent[] {
  const out: ControlEvent[] = []
  const tr = p.tracks.find((t) => t.id === track)
  if (!tr || !ownAudible(p, tr)) return out
  const map = projectBeatMap(p)
  for (const b of midiBlocks(p)) {
    if (b.track !== track || b.mute || !b.curves?.length) continue
    const b0 = map.toBeat(b.start)
    const len = blockBeats(map, b)
    for (const c of b.curves) {
      for (const pt of curveSteps(playedPoints(c.points, b.loop, len), len)) {
        const t = map.toSec(b0 + pt.t)
        if (t >= from && t < to) out.push({ time: zero + t, kind: c.kind, cc: c.cc ?? 0, value: pt.v })
      }
    }
  }
  return out.sort((a, b) => a.time - b.time)
}
