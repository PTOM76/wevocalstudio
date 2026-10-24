// プロジェクト全体の設定（マーカー、曲の終わり、テンポ、マスター）を変える処理。プロジェクトを受け取って新しいプロジェクトを返す純粋な関数で、React を使わない
import { projectBeatMap } from '../../beats'
import type { FxSlot } from 'wevocal-lib'
import { newId, type Marker, type Master, type Project, type Tempo } from '../../project'

/** マーカーを足す（同じ位置にあれば足さない）。名前は M1、M2… */
export const addMarker = (p: Project, time: number): Project =>
  p.markers.some((m) => Math.abs(m.time - time) < 1e-3) ? p : { ...p, markers: [...p.markers, { id: newId(), time, name: `M${p.markers.length + 1}` }].sort((a, b) => a.time - b.time) }

export const patchMarker = (p: Project, id: string, patch: Partial<Marker>): Project => ({ ...p, markers: p.markers.map((m) => (m.id === id ? { ...m, ...patch } : m)) })

export const removeMarker = (p: Project, id: string): Project => ({ ...p, markers: p.markers.filter((m) => m.id !== id) })

/** 曲の終わりを決める。null で自動に戻す */
export function setEnd(p: Project, time: number | null): Project {
  const { end: _, ...rest } = p
  return time === null ? rest : { ...rest, end: time }
}

/** テンポを変える。MIDI ブロックは拍の位置を保つよう、位置と長さ（秒）を直す */
export function patchTempo(p: Project, patch: Partial<Tempo>): Project {
  const next = { ...p, tempo: { ...p.tempo, ...patch } }
  if (!p.midi?.length) return next
  const was = projectBeatMap(p)
  const now = projectBeatMap(next)
  return {
    ...next,
    midi: p.midi.map((b) => {
      const start = now.toSec(was.toBeat(b.start))
      return { ...b, start, length: now.toSec(was.toBeat(b.start + b.length)) - start }
    }),
  }
}

/**
 * BPM を変え、曲全体をそのテンポに合わせて伸縮する（設定の「テンポ変更時に全体を伸縮する」。WeVocalSynth と同じ）。
 * 波形ブロックは速度を変えて元の音の同じ範囲を鳴らす（ピッチは変えない。元の音は書き換えない）。位置、フェード、エンベロープ、マーカー、
 * 曲の終わり、オートメーション、1 拍目の位置も「旧 BPM ÷ 新 BPM」倍にする。MIDI ブロックは patchTempo で拍の位置を保つ
 */
export function stretchToTempo(p: Project, bpm: number): Project {
  const r = p.tempo.bpm / bpm
  if (!(r > 0) || !Number.isFinite(r) || Math.abs(r - 1) < 1e-9) return patchTempo(p, { bpm })
  const fx = (list: FxSlot[] | undefined) => list?.map((s) => (s.auto ? { ...s, auto: Object.fromEntries(Object.entries(s.auto).map(([k, pts]) => [k, pts.map((q) => ({ ...q, t: q.t * r }))])) } : s))
  const scaled: Project = {
    ...p,
    blocks: p.blocks.map((b) => ({
      ...b,
      start: b.start * r,
      length: b.length * r,
      rate: b.rate / r,
      fadeIn: b.fadeIn * r,
      fadeOut: b.fadeOut * r,
      ...(b.glide ? { glide: b.glide * r } : {}),
      ...(b.envelope ? { envelope: b.envelope.map((q) => ({ ...q, t: q.t * r })) } : {}),
    })),
    markers: p.markers.map((m) => ({ ...m, time: m.time * r })),
    ...(p.end !== undefined ? { end: p.end * r } : {}),
    tracks: p.tracks.map((t) => (t.fx ? { ...t, fx: fx(t.fx) } : t)),
    master: p.master.fx ? { ...p.master, fx: fx(p.master.fx) } : p.master,
  }
  return patchTempo(scaled, { bpm, beatOffset: p.tempo.beatOffset * r })
}

/** 見つけたテンポの変化を採用する。最初の区間は曲の頭のテンポにし、続く区間の位置にテンポを持つマーカーを置く（同じ位置のマーカーにはテンポを持たせる） */
export function adoptTempoChanges(p: Project, sections: { time: number; bpm: number; offset: number }[]): Project {
  const [first, ...rest] = sections
  if (!first) return p
  const beat = 60 / first.bpm
  let next = patchTempo(p, { bpm: first.bpm, beatOffset: ((first.offset % beat) + beat) % beat })
  const { beatsPerBar } = next.tempo
  for (const s of rest) {
    const same = next.markers.find((m) => Math.abs(m.time - s.time) < 1e-3)
    const tempo = { bpm: s.bpm, beatsPerBar }
    next = same ? patchMarker(next, same.id, { tempo }) : { ...next, markers: [...next.markers, { id: newId(), time: s.time, name: `M${next.markers.length + 1}`, tempo }].sort((a, b) => a.time - b.time) }
  }
  return next
}

export const patchMaster = (p: Project, patch: Partial<Master>): Project => ({ ...p, master: { ...p.master, ...patch } })
