// MIDI ブロックのループ（loop 拍ごとに、頭からの中身を繰り返す）の展開と、MIDI ブロックの接着。画面を知らない
import { beatMap, blockBeats } from './beats'
import { sortPoints } from './midiCurves'
import { newId, type MidiBlock, type MidiCurve, type Note, type Project } from './project'

/** 鳴らす音符の 1 回分（ブロックの頭からの拍。長さはブロックの終わりとループの終わりで切ってある） */
export interface PlayedNote {
  note: Note
  t: number
  dur: number
}

/**
 * ブロック（長さ len 拍）が鳴らす音符。ループがなければ、ブロックの中の音符（終わりで切る）。
 * ループがあれば、ループの中（頭から loop 拍まで）の音符を、loop 拍ごとに繰り返して、ブロックの終わりまで
 */
export function playedNotes(b: Pick<MidiBlock, 'notes' | 'loop'>, len: number): PlayedNote[] {
  const loop = b.loop && b.loop > 0 ? b.loop : 0
  const out: PlayedNote[] = []
  for (let k = 0; ; k++) {
    const base = loop * k
    if (k > 0 && (!loop || base >= len - 1e-9)) break
    for (const note of b.notes) {
      if (loop && note.t >= loop) continue
      const t = base + note.t
      // ループの終わりと、ブロックの終わりで切る
      const dur = Math.min(note.dur, len - t, loop ? loop - note.t : Infinity)
      if (t < len && dur > 0) out.push({ note, t, dur })
    }
    if (!loop) break
  }
  return out
}

/** コントロールの曲線の点を、ループの分だけ繰り返す（ループがなければそのまま） */
export function playedPoints(points: { t: number; v: number }[], loop: number | undefined, len: number) {
  if (!loop || loop <= 0) return points
  const out: { t: number; v: number }[] = []
  const sorted = sortPoints(points).filter((p) => p.t < loop)
  for (let base = 0; base < len - 1e-9; base += loop) for (const p of sorted) out.push({ t: base + p.t, v: p.v })
  return out
}

/** ids の MIDI ブロックのうち、同じトラックのものを 1 つにつなぐ（トラックごとに 1 つ）。つなぐ相手が 2 つ以上なければ、そのまま */
export function glueMidi(p: Project, ids: string[]): Project {
  const map = beatMap(p.tempo, p.markers)
  const midi = p.midi ?? []
  const next: MidiBlock[] = []
  const done = new Set<string>()
  for (const b of midi) {
    if (done.has(b.id)) continue
    const group = ids.includes(b.id) ? midi.filter((q) => ids.includes(q.id) && q.track === b.track) : [b]
    if (group.length < 2) {
      next.push(b)
      continue
    }
    group.forEach((q) => done.add(q.id))
    const start = Math.min(...group.map((q) => q.start))
    const end = Math.max(...group.map((q) => q.start + q.length))
    const origin = map.toBeat(start)
    const notes: Note[] = []
    const curves = new Map<string, MidiCurve>()
    for (const q of group) {
      const shift = map.toBeat(q.start) - origin
      // ループは展開して、つないだ 1 つのブロックの音符にする
      for (const pn of playedNotes(q, blockBeats(map, q))) notes.push({ ...pn.note, id: newId(), t: pn.t + shift, dur: pn.dur })
      for (const c of q.curves ?? []) {
        const key = `${c.kind}:${c.cc ?? 0}`
        const have = curves.get(key)
        const points = playedPoints(c.points, q.loop, blockBeats(map, q)).map((pt) => ({ t: pt.t + shift, v: pt.v }))
        curves.set(key, { ...c, points: sortPoints([...(have?.points ?? []), ...points]) })
      }
    }
    const first = group.sort((a, z) => a.start - z.start)[0]
    const { loop: _loop, curves: _curves, ...rest } = first
    next.push({ ...rest, start, length: end - start, mute: group.every((q) => q.mute), notes, ...(curves.size ? { curves: [...curves.values()] } : {}) })
  }
  return { ...p, midi: next }
}
