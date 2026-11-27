// 中間の形（ほかの DAW から読んだもの）から Studio のプロジェクトを作る（memo/daw-exchange.md）。見つからない音声は無音の仮の音にして、missing に元のパスを残す
import type { Clip } from 'wevocal-lib'
import { fillBlock, newId, newProject, newTrack, RATE_MAX, RATE_MIN, type Marker, type MidiBlock, type MidiCurve, type Project, type Source } from '../project'
import { notesOf, PPQ, type XMidi, type XProject } from './exchange'

/** 仮の音の標本化周波数（無音なので低くてよい） */
const SILENT_RATE = 8000

/** パスの最後の名前（拡張子つき） */
export const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path

/** MIDI のイベントから、Studio の MIDI ブロックを作る（CC とピッチベンドは曲線の点） */
function midiBlock(m: XMidi, track: string): MidiBlock {
  const curves = new Map<string, MidiCurve>()
  for (const e of m.events) {
    const st = e.bytes[0] & 0xf0
    if (st === 0xb0) {
      const key = `cc${e.bytes[1]}`
      if (!curves.has(key)) curves.set(key, { kind: 'cc', cc: e.bytes[1], points: [] })
      curves.get(key)!.points.push({ t: e.tick / PPQ, v: e.bytes[2] / 127 })
    } else if (st === 0xe0) {
      if (!curves.has('bend')) curves.set('bend', { kind: 'bend', points: [] })
      curves.get('bend')!.points.push({ t: e.tick / PPQ, v: (((e.bytes[2] << 7) | e.bytes[1]) / 16383) * 2 - 1 })
    }
  }
  const notes = notesOf(m).map((n) => ({ id: newId(), t: n.time, dur: n.duration, pitch: n.key, vel: n.vel }))
  return { id: newId(), track, name: m.name || undefined, start: m.start, length: m.length, mute: m.mute, unit: 'beat', notes, ...(curves.size ? { curves: [...curves.values()] } : {}) }
}

/**
 * 中間の形からプロジェクトを作る。audio はファイルのパス → 音（見つからなければ無い）。
 * 返す missing は見つからなかったパスの数
 */
export function fromExchange(x: XProject, audio: Map<string, Clip>): { project: Project; missing: number } {
  const p = newProject(x.bpm)
  p.tempo = { ...p.tempo, bpm: x.bpm, beatsPerBar: x.beatsPerBar }
  p.master = { ...p.master, ...x.master }
  // マーカーと途中のテンポの変化（同じ位置にマーカーがあれば、そのマーカーにテンポを持たせる）
  const markers: Marker[] = x.markers.map((m) => ({ id: newId(), time: m.time, name: m.name }))
  for (const t of x.tempos) {
    const same = markers.find((m) => Math.abs(m.time - t.time) < 1e-6)
    const tempo = { bpm: t.bpm, beatsPerBar: t.beatsPerBar }
    if (same) same.tempo = tempo
    else markers.push({ id: newId(), time: t.time, name: '', tempo })
  }
  p.markers = markers.sort((a, b) => a.time - b.time)

  // 使う長さ（仮の音の長さを決める）
  const need = new Map<string, number>()
  for (const t of x.tracks) for (const c of t.clips) need.set(c.file, Math.max(need.get(c.file) ?? 0, c.offset + c.length * c.rate))
  const sources = new Map<string, Source>()
  let missing = 0
  for (const [file, dur] of need) {
    const clip = audio.get(file)
    const name = baseName(file)
    if (clip) sources.set(file, { id: newId(), name, clip, duration: clip.channels[0].length / clip.sampleRate })
    else {
      missing++
      const frames = Math.max(1, Math.ceil(dur * SILENT_RATE))
      sources.set(file, { id: newId(), name, clip: { sampleRate: SILENT_RATE, channels: [new Float32Array(frames)] }, duration: frames / SILENT_RATE, missing: file })
    }
  }
  p.sources = [...sources.values()]

  // トラック（深さから親を決める）
  p.tracks = []
  p.blocks = []
  const midi: MidiBlock[] = []
  const parents: string[] = []
  x.tracks.forEach((t, i) => {
    parents.length = Math.min(parents.length, t.depth)
    const track = { ...newTrack(i + 1), name: t.name || `Track ${i + 1}`, volume: t.volume, pan: t.pan, mute: t.mute, solo: t.solo, ...(t.invert ? { invert: true } : {}), ...(parents.length ? { parent: parents[parents.length - 1] } : {}) }
    p.tracks.push(track)
    parents[t.depth] = track.id
    for (const c of t.clips) {
      const s = sources.get(c.file)!
      p.blocks.push(
        fillBlock({ id: newId(), track: track.id, source: s.id, start: c.start, length: c.length, offset: c.offset, rate: Math.max(RATE_MIN, Math.min(RATE_MAX, c.rate)), gain: c.gain, pitch: c.pitch, fadeIn: c.fadeIn, fadeOut: c.fadeOut, mute: c.mute, ...(c.name ? { name: c.name } : {}) }),
      )
    }
    for (const m of t.midi) midi.push(midiBlock(m, track.id))
  })
  if (!p.tracks.length) p.tracks = [newTrack(1)]
  if (midi.length) p.midi = midi
  return { project: p, missing }
}

/** 見つからなかった音声（missing のある Source）に音を割り当てる。ブロックの位置と範囲はそのまま */
export function assignAudio(p: Project, source: string, clip: Clip, name: string): Project {
  return { ...p, sources: p.sources.map((s) => (s.id === source ? { id: s.id, name, clip, duration: clip.channels[0].length / clip.sampleRate } : s)) }
}
