// MIDI ファイルの書き出し。MIDI ブロックを、トラックごとの音符にして標準 MIDI ファイルにする。画面を知らない
import { midiBlocks } from './project'
import { writeMidi, type MidiWriteTrack } from 'wevocal-lib'
import { projectBeatMap } from './beats'
import type { MidiBlock, Project } from './project'

/**
 * 書き出す MIDI ブロック（ids があればそのうち、なければ全部）の標準 MIDI ファイル。ミュートしたブロックと音符は入れない。
 * 時間はプロジェクトの頭（0 秒）をファイルの頭にし、テンポと拍子はプロジェクトのもの（マーカーのテンポの変化も）。入れるものがなければ null
 */
export function buildMidi(p: Project, ids?: string[]): Uint8Array | null {
  const map = projectBeatMap(p)
  const origin = map.toBeat(0)
  const blocks = midiBlocks(p).filter((b) => !b.mute && (!ids?.length || ids.includes(b.id)))
  const tracks: MidiWriteTrack[] = []
  for (const track of p.tracks) {
    const mine: MidiBlock[] = blocks.filter((b) => b.track === track.id)
    const notes = mine.flatMap((b) => {
      const b0 = map.toBeat(b.start) - origin
      return b.notes.filter((n) => !n.mute).map((n) => ({ startBeat: b0 + n.t, endBeat: b0 + n.t + n.dur, note: n.pitch, vel: n.vel }))
    })
    // コントロール（CC、ピッチベンド）の点
    const controls = mine.flatMap((b) => {
      const b0 = map.toBeat(b.start) - origin
      return (b.curves ?? []).flatMap((c) => c.points.map((pt) => ({ kind: c.kind, ...(c.kind === 'cc' ? { cc: c.cc ?? 0 } : {}), beat: b0 + pt.t, value: pt.v })))
    })
    if (notes.length) tracks.push({ name: track.name, notes, ...(controls.length ? { controls } : {}) })
  }
  if (!tracks.length) return null
  const tempos = [{ beat: 0, bpm: p.tempo.bpm }, ...p.markers.filter((m) => m.tempo && m.time > 0).map((m) => ({ beat: map.toBeat(m.time) - origin, bpm: m.tempo!.bpm }))]
  return writeMidi(tracks, { tempos, beatsPerBar: p.tempo.beatsPerBar })
}
