// トラックを変える処理（足す、複製、貼り付け、消す、階層、並べ替え）。プロジェクトを受け取って新しいプロジェクトを返す純粋な関数で、React を使わない
import type { AutoPoint, FxSlot } from 'wevocal-lib'
import { TRACK_HEIGHT_MAX, TRACK_HEIGHT_MIN, midiBlocks, newBlock, newId, newTrack, subtreeEnd, trackHeight, type Block, type PitchDefaults, type Project, type Source, type Track } from '../../project'
import { addSources } from './blocks'

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

/** トラックの写し copy（新しい id のもの）を、after のすぐ下（なければ一番下）に波形ブロックごと置く。sources は、コピーしたときの元の音（足りなければ足す）。元の音がどこにも無いブロックは置かない */
export function insertTrack(q: Project, copy: Track, blocks: Block[], after: string | null, sources: Source[] = []): Project {
  const p = addSources(q, sources)
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

/**
 * 選んでいるトラックの 1 つを変えたとき、選んだもの全部に同じだけ掛ける（音量、パン、高さは差分で。選んだトラックの違いは保つ）。
 * 掛けないとき（1 つだけ、選んでいないトラック、名前と FX の変更）は null
 */
export function spreadTrackPatch(p: Project, selectedTracks: string[], id: string, patch: Partial<Track>): Record<string, Partial<Track>> | null {
  if (selectedTracks.length < 2 || !selectedTracks.includes(id) || 'name' in patch || 'fx' in patch) return null
  const base = p.tracks.find((tr) => tr.id === id)
  if (!base) return null
  return Object.fromEntries(
    p.tracks
      .filter((tr) => selectedTracks.includes(tr.id))
      .map((tr) => {
        const q: Partial<Track> = { ...patch }
        if (patch.volume !== undefined) q.volume = Math.max(-60, Math.min(12, tr.volume + patch.volume - base.volume))
        if (patch.pan !== undefined) q.pan = Math.max(-1, Math.min(1, tr.pan + patch.pan - base.pan))
        if (patch.height !== undefined) q.height = Math.max(TRACK_HEIGHT_MIN, Math.min(TRACK_HEIGHT_MAX, trackHeight(tr) + patch.height - trackHeight(base)))
        return [tr.id, q]
      }),
  )
}

/** FX の項目（target はトラックの id か 'master'、slot は何番目か）のつまみ param のオートメーションの点を入れ替える。項目がなければそのまま */
export function setAutoPoints(p: Project, target: string, slot: number, param: string, points: AutoPoint[]): Project {
  const put = (fx: FxSlot[] | undefined) => fx?.map((s, i) => (i === slot ? { ...s, auto: { ...s.auto, [param]: points } } : s))
  if (target === 'master') return p.master.fx?.[slot] ? { ...p, master: { ...p.master, fx: put(p.master.fx) } } : p
  const t = p.tracks.find((x) => x.id === target)
  return t?.fx?.[slot] ? patchTrack(p, target, { fx: put(t.fx) }) : p
}
