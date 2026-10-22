// MIDI ファイルの読み込み。選んだトラック（チャンネルで分けることもできる）ごとに、新しいトラックと MIDI ブロックを作る（音源は標準のシンセ）。画面を知らない
import { defaultValues, findInstrument, parseMidi, type MidiFile } from 'wevocal-lib'
import { projectBeatMap } from './beats'
import { newId, newTrack, type InstrumentSlot, type Marker, type MidiBlock, type MidiCurve, type Note, type Project, type Track } from './project'

/** 標準のシンセの音源（新しい MIDI ブロックの既定） */
export function defaultInstrument(): InstrumentSlot {
  const synth = findInstrument('wevocal.synth')
  return { plugin: 'wevocal.synth', values: synth ? defaultValues(synth.manifest) : {} }
}

/** 読み込みの選択待ちの MIDI ファイル */
export interface MidiPending {
  name: string
  midi: MidiFile
}

export interface MidiImportOptions {
  /** 読み込むトラックの番号（midi.tracks の並びで） */
  tracks: number[]
  /** チャンネルごとにトラックを分ける */
  splitChannels: boolean
  /** project: プロジェクトのテンポに乗せる（音符は拍の位置のまま）、midi: MIDI のテンポと拍子をプロジェクトに入れる */
  tempo: 'project' | 'midi'
}

/** MIDI ファイルを読む。音符のあるトラックがなければ null */
export async function readMidi(file: File): Promise<MidiPending | null> {
  const midi = parseMidi(await file.arrayBuffer())
  return midi.tracks.length ? { name: file.name, midi } : null
}

/** MIDI のコントロール（CC、ピッチベンド）を、ブロックの曲線にする。頭（first 拍）より前の値は、頭の値にする */
function curvesOf(controls: MidiFile['tracks'][number]['controls'], first: number): MidiCurve[] {
  const groups = new Map<string, { kind: 'cc' | 'bend'; cc: number; list: { t: number; v: number }[] }>()
  for (const c of controls) {
    const g = groups.get(`${c.kind}:${c.cc}`) ?? { kind: c.kind, cc: c.cc, list: [] }
    g.list.push({ t: c.beat - first, v: c.value })
    groups.set(`${c.kind}:${c.cc}`, g)
  }
  return [...groups.values()].flatMap((g) => {
    const sorted = g.list.sort((a, b) => a.t - b.t)
    const before = sorted.filter((p) => p.t < 0).pop()
    const points = [...(before ? [{ t: 0, v: before.v }] : []), ...sorted.filter((p) => p.t >= 0)]
    return points.length ? [{ kind: g.kind, ...(g.kind === 'cc' ? { cc: g.cc } : {}), points }] : []
  })
}

/** MIDI のテンポと拍子を、at 秒を 1 拍目としてプロジェクトに入れる（途中の変化はマーカーのテンポにする） */
function adoptTempo(p: Project, midi: MidiFile, at: number): Project {
  const markers: Marker[] = []
  let sec = at
  let beat = 0
  let bpm = midi.bpm
  for (const tp of midi.tempos) {
    sec += ((tp.beat - beat) * 60) / bpm
    beat = tp.beat
    bpm = tp.bpm
    if (tp.beat > 0) markers.push({ id: newId(), time: sec, name: '', tempo: { bpm: tp.bpm, beatsPerBar: midi.beatsPerBar } })
  }
  return { ...p, tempo: { bpm: midi.bpm, beatsPerBar: midi.beatsPerBar, beatOffset: at }, markers: [...p.markers.filter((m) => !m.tempo), ...markers] }
}

/** MIDI ファイルを、at 秒から始まるトラックと MIDI ブロックにして足したプロジェクト。音符が 1 つもなければ null */
export function importMidi(p: Project, pending: MidiPending, at: number, o: MidiImportOptions): Project | null {
  const q = o.tempo === 'midi' ? adoptTempo(p, pending.midi, at) : p
  const map = projectBeatMap(q)
  // ファイルの 0 拍目が、at の拍にあたる
  const origin = map.toBeat(at)
  const tracks: Track[] = []
  const blocks: MidiBlock[] = []
  for (const i of o.tracks) {
    const mt = pending.midi.tracks[i]
    if (!mt) continue
    const groups = new Map<number, typeof mt.notes>()
    for (const n of mt.notes) groups.set(o.splitChannels ? n.ch : 0, [...(groups.get(o.splitChannels ? n.ch : 0) ?? []), n])
    for (const [ch, notes] of [...groups].sort((a, b) => a[0] - b[0])) {
      const label = o.splitChannels && groups.size > 1 ? `${mt.name} ch${ch + 1}` : mt.name
      const track = { ...newTrack(q.tracks.length + tracks.length + 1), name: label || `MIDI ${tracks.length + 1}`, instrument: defaultInstrument() }
      const first = Math.min(...notes.map((n) => n.startBeat))
      const controls = mt.controls.filter((c) => !o.splitChannels || c.ch === ch)
      const last = Math.max(...notes.map((n) => n.endBeat))
      const start = map.toSec(origin + first)
      tracks.push(track)
      blocks.push({
        id: newId(),
        track: track.id,
        start,
        length: Math.max(0.05, map.toSec(origin + last) - start),
        mute: false,
        defaultName: pending.name,
        unit: 'beat',
        ...(controls.length ? { curves: curvesOf(controls, first) } : {}),
        notes: notes.map((n): Note => ({ id: newId(), t: n.startBeat - first, dur: Math.max(1 / 32, n.endBeat - n.startBeat), pitch: n.note, vel: n.vel })),
      })
    }
  }
  if (!blocks.length) return null
  return { ...q, tracks: [...q.tracks, ...tracks], midi: [...(q.midi ?? []), ...blocks] }
}
