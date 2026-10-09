// 波形の描画用のピーク（縮めた形）。元の音ごとに一度だけ、何段階かの細かさで最小と最大を作っておく（描くたびに元の音を読まないように）
import type { Clip } from 'wevocal-lib'

/** 一番細かい段の 1 つ分のサンプル数。段が 1 つ上がるごとに 4 倍 */
const BASE = 64
const FACTOR = 4

interface Level {
  /** 1 つ分のサンプル数 */
  size: number
  min: Float32Array
  max: Float32Array
}

const cache = new WeakMap<Clip, Level[]>()

function build(clip: Clip): Level[] {
  const data = clip.channels[0]
  const n = Math.ceil(data.length / BASE)
  const min = new Float32Array(n)
  const max = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let lo = 0
    let hi = 0
    const end = Math.min(data.length, (i + 1) * BASE)
    for (let j = i * BASE; j < end; j++) {
      const v = data[j]
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    min[i] = lo
    max[i] = hi
  }
  const levels: Level[] = [{ size: BASE, min, max }]
  // 上の段は下の段の FACTOR 個ずつをまとめる
  while (levels[levels.length - 1].min.length > 1) {
    const prev = levels[levels.length - 1]
    const m = Math.ceil(prev.min.length / FACTOR)
    const lmin = new Float32Array(m)
    const lmax = new Float32Array(m)
    for (let i = 0; i < m; i++) {
      let lo = 0
      let hi = 0
      for (let j = i * FACTOR; j < Math.min(prev.min.length, (i + 1) * FACTOR); j++) {
        if (prev.min[j] < lo) lo = prev.min[j]
        if (prev.max[j] > hi) hi = prev.max[j]
      }
      lmin[i] = lo
      lmax[i] = hi
    }
    levels.push({ size: prev.size * FACTOR, min: lmin, max: lmax })
  }
  return levels
}

/**
 * サンプル a〜b の最小と最大。1 画素に入るサンプル数（perPx）に合った段を使う。
 * 1 画素が一番細かい段より細かければ、元の音をそのまま読む（拡大したとき）
 */
export function peakRange(clip: Clip, a: number, b: number, perPx: number, out: { lo: number; hi: number }) {
  let lo = 0
  let hi = 0
  if (perPx < BASE * 2) {
    const data = clip.channels[0]
    for (let i = Math.max(0, a); i < Math.min(data.length, b); i++) {
      const v = data[i]
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
  } else {
    let levels = cache.get(clip)
    if (!levels) cache.set(clip, (levels = build(clip)))
    // 1 画素に 2 つ以上入る一番粗い段
    let L = levels[0]
    for (const l of levels) if (l.size * 2 <= perPx) L = l
    const i0 = Math.max(0, Math.floor(a / L.size))
    const i1 = Math.min(L.min.length, Math.ceil(b / L.size))
    for (let i = i0; i < i1; i++) {
      if (L.min[i] < lo) lo = L.min[i]
      if (L.max[i] > hi) hi = L.max[i]
    }
  }
  out.lo = lo
  out.hi = hi
}
