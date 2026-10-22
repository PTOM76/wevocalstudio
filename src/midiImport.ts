// MIDI ファイルの読み込み。音符のあるトラックごとに、新しいトラックと MIDI ブロックを作る（音源は標準のシンセ）。画面を知らない
import { defaultValues, findInstrument, parseMidi } from 'wevocal-lib'
import { newId, newTrack, type InstrumentSlot, type MidiBlock, type Project, type Track } from './project'

/** 標準のシンセの音源（新しい MIDI ブロックの既定） */
export function defaultInstrument(): InstrumentSlot {
  const synth = findInstrument('wevocal.synth')
  return { plugin: 'wevocal.synth', values: synth ? defaultValues(synth.manifest) : {} }
}

/** MIDI ファイルを、at 秒から始まるトラックと MIDI ブロックにして足したプロジェクト。音符が 1 つもなければ null */
export async function importMidi(p: Project, file: File, at: number): Promise<Project | null> {
  const midi = parseMidi(await file.arrayBuffer())
  if (!midi.tracks.length) return null
  const tracks: Track[] = []
  const blocks: MidiBlock[] = []
  for (const mt of midi.tracks) {
    const track = { ...newTrack(p.tracks.length + tracks.length + 1), name: mt.name || `MIDI ${tracks.length + 1}`, instrument: defaultInstrument() }
    const start = Math.min(...mt.notes.map((n) => n.start))
    const end = Math.max(...mt.notes.map((n) => n.end))
    tracks.push(track)
    blocks.push({
      id: newId(),
      track: track.id,
      start: at + start,
      length: Math.max(0.05, end - start),
      mute: false,
      defaultName: file.name,
      notes: mt.notes.map((n) => ({ id: newId(), t: n.start - start, dur: Math.max(0.02, n.end - n.start), pitch: n.note, vel: 0.8 })),
    })
  }
  return { ...p, tracks: [...p.tracks, ...tracks], midi: [...(p.midi ?? []), ...blocks] }
}
