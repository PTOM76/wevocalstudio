// トラックを変える処理（足す、複製、貼り付け、消す、階層、並べ替え）。プロジェクトを受け取って新しいプロジェクトを返す純粋な関数で、React を使わない
import { midiBlocks, newBlock, newId, newTrack, subtreeEnd, type Block, type PitchDefaults, type Project, type Source, type Track } from '../../project'

/** after のすぐ下（子孫の後ろ。なければ一番下）に、空のトラック track を足す。名前は Track N */
export function addTrackAfter(p: Project, track: Track, after?: string | null): Project {
  const i = after ? p.tracks.findIndex((t) => t.id === after) : -1
  const at = i < 0 ? p.tracks.length : subtreeEnd(p, i)
  return { ...p, tracks: [...p.tracks.slice(0, at), { ...track, name: `Track ${p.tracks.length + 1}` }, ...p.tracks.slice(at)] }
}

/** parent の子として、空のトラック track を親の子孫の一番後ろに足す（サブトラック）。親は開く */
export function addSubtrack(p: Project, track: Track, parent: string): Project {
  const i = p.tracks.findIndex((t) => t.id === parent)
  if (i < 0) return p
  const at = subtreeEnd(p, i)
  const child = { ...track, name: `Track ${p.tracks.length + 1}`, parent }
  return { ...p, tracks: [...p.tracks.slice(0, at), child, ...p.tracks.slice(at)].map((t) => (t.id === parent ? { ...t, collapsed: false } : t)) }
}

/** トラックを、波形ブロックと MIDI ブロックごと写して、すぐ下に置く */
export function duplicateTrack(p: Project, id: string): Project {
  const i = p.tracks.findIndex((t) => t.id === id)
  if (i < 0) return p
  const copy = { ...p.tracks[i], id: newId(), name: `${p.tracks[i].name} (2)`, armed: false }
  const blocks = p.blocks.filter((b) => b.track === id).map((b) => ({ ...b, id: newId(), track: copy.id }))
  const midi = midiBlocks(p).filter((b) => b.track === id).map((b) => ({ ...b, id: newId(), track: copy.id }))
  return { ...p, tracks: [...p.tracks.slice(0, i + 1), copy, ...p.tracks.slice(i + 1)], blocks: [...p.blocks, ...blocks], ...(midi.length ? { midi: [...midiBlocks(p), ...midi] } : {}) }
}

/** トラックの写し copy（新しい id のもの）を、after のすぐ下（なければ一番下）に波形ブロックごと置く。元の音がもう無いブロックは置かない */
export function insertTrack(p: Project, copy: Track, blocks: Block[], after: string | null): Project {
  const i = after ? p.tracks.findIndex((t) => t.id === after) : -1
  const at = i < 0 ? p.tracks.length : i + 1
  const bs = blocks.filter((b) => p.sources.some((s) => s.id === b.source)).map((b) => ({ ...b, id: newId(), track: copy.id }))
  return { ...p, tracks: [...p.tracks.slice(0, at), copy, ...p.tracks.slice(at)], blocks: [...p.blocks, ...bs] }
}

/** トラックと、そのブロックを消す。子は一つ上の階層に上げる。使われなくなった元の音も消す */
export function removeTrack(p: Project, id: string): Project {
  const blocks = p.blocks.filter((b) => b.track !== id)
  const midi = p.midi?.filter((b) => b.track !== id)
  const gone = p.tracks.find((t) => t.id === id)
  const tracks = p.tracks.filter((t) => t.id !== id).map((t) => (t.parent === id ? { ...t, parent: gone?.parent } : t))
  return { ...p, tracks, blocks, ...(midi ? { midi } : {}), sources: p.sources.filter((s) => blocks.some((b) => b.source === s.id) || tracks.some((t) => t.frozen?.source === s.id || t.instrument?.sample === s.id)) }
}

/** 上の同じ階層のトラックの中に入れる */
export function indentTrack(p: Project, id: string): Project {
  const i = p.tracks.findIndex((t) => t.id === id)
  const me = p.tracks[i]
  if (!me) return p
  const above = p.tracks.slice(0, i).reverse().find((t) => t.parent === me.parent)
  return above ? { ...p, tracks: p.tracks.map((t) => (t.id === id ? { ...t, parent: above.id } : t.id === above.id ? { ...t, collapsed: false } : t)) } : p
}

/** 親の外に出す。子孫ごと、親の子孫の一番後ろへ動かす（並びを崩さないように） */
export function outdentTrack(p: Project, id: string): Project {
  const i = p.tracks.findIndex((t) => t.id === id)
  const me = p.tracks[i]
  const parent = me && p.tracks.find((t) => t.id === me.parent)
  if (!parent) return p
  const mine = p.tracks.slice(i, subtreeEnd(p, i))
  const rest = p.tracks.filter((t) => !mine.includes(t))
  const pi = rest.findIndex((t) => t.id === parent.id)
  const at = subtreeEnd({ ...p, tracks: rest }, pi)
  const moved = mine.map((t) => (t.id === id ? { ...t, parent: parent.parent } : t))
  return { ...p, tracks: [...rest.slice(0, at), ...moved, ...rest.slice(at)] }
}

/** トラックを子孫ごと、指定のスロットに移動する。to は「この番号のトラックの前」（0～N） */
export function reorderTrack(p: Project, id: string, to: number): Project {
  const from = p.tracks.findIndex((t) => t.id === id)
  if (from < 0) return p
  const mine = p.tracks.slice(from, subtreeEnd(p, from))
  const rest = p.tracks.filter((t) => !mine.includes(t))
  const clamped = Math.max(0, Math.min(rest.length, to))
  if (clamped === from) return p
  return { ...p, tracks: [...rest.slice(0, clamped), ...mine, ...rest.slice(clamped)] }
}

/** トラックを 1 つ変える */
export const patchTrack = (p: Project, id: string, patch: Partial<Track>): Project => ({ ...p, tracks: p.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)) })

/** トラックをまとめて変える（id → 変える値） */
export const patchTracks = (p: Project, patches: Record<string, Partial<Track>>): Project => ({ ...p, tracks: p.tracks.map((t) => (patches[t.id] ? { ...t, ...patches[t.id] } : t)) })

/**
 * 読み込んだ音 source を、波形ブロックとして start 秒に置く。at のトラックがあればそこへ。
 * なければ、波形ブロックのない最初のトラックを使い（名前はファイル名にする）、それも無ければトラックを足す
 */
export function placeSource(p: Project, source: Source, name: string, at: string | undefined, start: number, defaults: PitchDefaults, defaultFade: number): Project {
  let tracks = p.tracks
  let track = at ? tracks.find((t) => t.id === at) : undefined
  if (!track) {
    const empty = tracks.find((t) => !p.blocks.some((b) => b.track === t.id))
    const named = { ...(empty ?? newTrack(tracks.length + 1)), name }
    track = named
    tracks = empty ? tracks.map((t) => (t.id === named.id ? named : t)) : [...tracks, named]
  }
  return { ...p, sources: [...p.sources, source], tracks, blocks: [...p.blocks, newBlock(track.id, source, start, defaults, defaultFade)] }
}
