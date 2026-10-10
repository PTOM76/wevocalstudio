// 範囲選択（全トラックにかかる時間の範囲）への編集。範囲だけ残す、範囲を消して詰める、無音を挿入する（WeVocalSynth の編集メニューと同じ操作）
import type { Range } from 'wevocal-lib'
import { splitBlock, type Block, type Marker, type Project } from './project'

/** 範囲の両端で、かかる波形ブロックを分ける */
function cutAt(blocks: Block[], r: Range): Block[] {
  return blocks.flatMap((b) => splitBlock(b, r.start) ?? [b]).flatMap((b) => splitBlock(b, r.end) ?? [b])
}

const inside = (b: Block, r: Range) => b.start >= r.start - 1e-6 && b.start + b.length <= r.end + 1e-6

/** 範囲の外を消す（範囲だけ残す。位置はそのまま） */
export function cropToRange(p: Project, r: Range): Project {
  return { ...p, blocks: cutAt(p.blocks, r).filter((b) => inside(b, r)) }
}

/** 範囲の中を消し、後ろを前に詰める（マーカーも詰める） */
export function deleteRange(p: Project, r: Range): Project {
  const len = r.end - r.start
  const shift = (t: number) => (t >= r.end ? t - len : t)
  return {
    ...p,
    blocks: cutAt(p.blocks, r)
      .filter((b) => !inside(b, r))
      .map((b) => ({ ...b, start: shift(b.start) })),
    markers: p.markers.filter((m) => m.time < r.start || m.time >= r.end).map((m): Marker => ({ ...m, time: shift(m.time) })),
  }
}

/** 位置 at に長さ len の無音を入れ、後ろをずらす（かかる波形ブロックは分ける。マーカーもずらす） */
export function insertSilence(p: Project, at: number, len: number): Project {
  const shift = (t: number) => (t >= at - 1e-6 ? t + len : t)
  return {
    ...p,
    blocks: p.blocks.flatMap((b) => splitBlock(b, at) ?? [b]).map((b) => ({ ...b, start: shift(b.start) })),
    markers: p.markers.map((m) => ({ ...m, time: shift(m.time) })),
  }
}

/** 範囲の中身を、範囲のすぐ後ろに n 回並べる（後ろはずらす） */
export function repeatRange(p: Project, r: Range, n: number, newId: () => string): Project {
  const len = r.end - r.start
  let q = insertSilence(p, r.end, len * n)
  const piece = cutAt(q.blocks, r).filter((b) => inside(b, r))
  q = { ...q, blocks: cutAt(q.blocks, r) }
  const copies = Array.from({ length: n }, (_, i) => piece.map((b) => ({ ...b, id: newId(), start: b.start + len * (i + 1) }))).flat()
  return { ...q, blocks: [...q.blocks, ...copies] }
}

/** 選んだ波形ブロックのピークを `peakDb` にそろえる（波形ブロックの音量を変える。元の音はそのまま） */
export function normalizeBlocks(p: Project, ids: string[], peakDb = -1): Project {
  return {
    ...p,
    blocks: p.blocks.map((b) => {
      const src = ids.includes(b.id) && p.sources.find((s) => s.id === b.source)
      if (!src) return b
      const { clip } = src
      const from = Math.max(0, Math.floor(b.offset * clip.sampleRate))
      const to = Math.min(clip.channels[0].length, from + Math.ceil(b.length * b.rate * clip.sampleRate))
      let peak = 0
      for (const ch of clip.channels) for (let i = from; i < to; i++) peak = Math.max(peak, Math.abs(ch[i]))
      return peak > 0 ? { ...b, gain: Math.round((peakDb - 20 * Math.log10(peak)) * 10) / 10 } : b
    }),
  }
}
