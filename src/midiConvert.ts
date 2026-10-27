// 波形ブロックと MIDI ブロックの相互の変換（選んだ波形ブロックから MIDI ブロックを作る、MIDI ブロックの音符に波形ブロックを並べる）。画面を知らない
import { projectBeatMap } from './beats'
import { defaultInstrument } from './midiImport'
import { playedNotes } from './midiLoop'
import { placeOnNotes } from './sampler'
import { midiBlocks, newId, newTrack, type MidiBlock, type Note, type Project } from './project'

/** 波形ブロックの音程 0 を、この MIDI ノート番号にする（C4。音符から並べ戻すときの基準と同じ） */
export const BASE_NOTE = 60

const clampNote = (v: number) => Math.min(127, Math.max(0, Math.round(v)))

/**
 * ids の波形ブロックを、1 つの MIDI ブロックにする。1 つの波形ブロックが 1 つの音符で、位置と長さは拍に直し、
 * 音程は BASE_NOTE にブロックのピッチを足したもの、強さは音量（dB）から。元のブロックは残し、新しいトラック（標準のシンセ）に置く。
 * 戻り値の id は作った MIDI ブロック（作れなければ null）
 */
export function wavesToMidi(p: Project, ids: string[], name: string): { project: Project; id: string | null } {
  const blocks = p.blocks.filter((b) => ids.includes(b.id) && !b.mute)
  if (!blocks.length) return { project: p, id: null }
  const map = projectBeatMap(p)
  const start = Math.min(...blocks.map((b) => b.start))
  const end = Math.max(...blocks.map((b) => b.start + b.length))
  const origin = map.toBeat(start)
  const notes: Note[] = blocks
    .map((b) => ({ id: newId(), t: map.toBeat(b.start) - origin, dur: map.toBeat(b.start + b.length) - map.toBeat(b.start), pitch: clampNote(BASE_NOTE + b.pitch), vel: Math.min(1, Math.max(0.05, 10 ** (b.gain / 20))) }))
    .sort((a, b) => a.t - b.t)
  const last = blocks.reduce((m, b) => (b.start + b.length > m.start + m.length ? b : m))
  const index = p.tracks.findIndex((t) => t.id === last.track)
  const track = { ...newTrack(0), name, instrument: defaultInstrument(), parent: p.tracks[index]?.parent }
  const block: MidiBlock = { id: newId(), track: track.id, start, length: end - start, unit: 'beat', notes, mute: false }
  const tracks = [...p.tracks.slice(0, index + 1), track, ...p.tracks.slice(index + 1)]
  return { project: { ...p, tracks, midi: [...midiBlocks(p), block] }, id: block.id }
}

/**
 * MIDI ブロックの音符の位置に、波形ブロック templateId を並べる（新しいトラックを MIDI ブロックのトラックの下に足す）。
 * 音符の高さと BASE_NOTE の差だけピッチを変え、長さは音符に合わせて切る（波形ブロックが短ければそのまま）。ループ、ミュートの音符も反映する
 */
export function midiToWaves(p: Project, midiId: string, templateId: string, name: string): Project {
  const m = midiBlocks(p).find((b) => b.id === midiId)
  if (!m) return p
  const map = projectBeatMap(p)
  const origin = map.toBeat(m.start)
  const len = map.toBeat(m.start + m.length) - origin
  const notes = playedNotes(m, len)
    .filter((n) => !n.note.mute)
    .map((n) => ({ note: n.note.pitch, start: map.toSec(origin + n.t), end: map.toSec(origin + n.t + n.dur) }))
  return placeOnNotes(p, templateId, notes, BASE_NOTE, 'cut', 0, name)
}
