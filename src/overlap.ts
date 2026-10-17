// 重なった波形ブロックの段の割り当て（重なっている所だけトラックの高さを段に分ける）。画面を知らない
import type { Block } from './project'

/** 波形ブロックの段（row 番目、rows 段のうち） */
export interface Slot {
  row: number
  rows: number
}

/**
 * トラックの中で、重なりがつながっている波形ブロックのまとまりごとに段を割り当てる。
 * 重なっていないものは 1 段（トラックの高さいっぱい）
 */
/** 波形ブロックの並びごとの結果（並びは書き換えずに作り直すので、同じ配列なら同じ結果。描くたびに全部を並べ直さない） */
const cache = new WeakMap<Block[], Map<string, Slot>>()

export function layoutRows(blocks: Block[]): ReadonlyMap<string, Slot> {
  let out = cache.get(blocks)
  if (!out) cache.set(blocks, (out = compute(blocks)))
  return out
}

function compute(blocks: Block[]): Map<string, Slot> {
  const out = new Map<string, Slot>()
  const byTrack = new Map<string, Block[]>()
  for (const b of blocks) {
    const list = byTrack.get(b.track)
    if (list) list.push(b)
    else byTrack.set(b.track, [b])
  }
  for (const list of byTrack.values()) {
    const sorted = [...list].sort((a, b) => a.start - b.start)
    let group: Block[] = []
    let groupEnd = -Infinity
    const flush = () => {
      // 空いている一番上の段に入れる
      const ends: number[] = []
      const rows = new Map<string, number>()
      for (const b of group) {
        let r = ends.findIndex((e) => e <= b.start + 1e-9)
        if (r < 0) r = ends.length
        ends[r] = b.start + b.length
        rows.set(b.id, r)
      }
      for (const b of group) out.set(b.id, { row: rows.get(b.id)!, rows: ends.length })
      group = []
    }
    for (const b of sorted) {
      if (b.start >= groupEnd - 1e-9 && group.length) flush()
      group.push(b)
      groupEnd = Math.max(group.length > 1 ? groupEnd : -Infinity, b.start + b.length)
    }
    if (group.length) flush()
  }
  return out
}
