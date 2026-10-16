// 最適化して保存するためのプロジェクトの整理（波形ブロックの確定、使っていない元の音の部分を切る、使っていない元の音を消す）。元のプロジェクトは書き換えない
import { applyBaked, bakeBlocks, isNeutral, type BakeMode } from './bake'
import type { Block, Project, Source } from './project'

export interface OptimizeOptions {
  /** 波形ブロックの加工を確定する範囲（なし、ピッチと速度だけ、すべて） */
  bake: BakeMode | 'none'
  /** 確定する波形ブロック。null なら全部 */
  scope: string[] | null
  /** 使っていない元の音の部分（波形ブロックが使う範囲の外）を切り落とす */
  trim: boolean
  /** どの波形ブロックも使っていない元の音を消す */
  dropUnused: boolean
}

/** 波形ブロックが使う範囲の前後に残す余白（秒）。ピッチや速度の処理が前後の音を少し読むため */
const MARGIN = 0.1

/** 元の音をまとめた大きさ（バイト。保存するときは 32bit float） */
export const sourcesBytes = (p: Project) => p.sources.reduce((sum, s) => sum + s.clip.channels.length * s.clip.channels[0].length * 4, 0)

/** 元の音をどこかが使っているか（波形ブロック、トラックのフリーズ） */
function usedSources(p: Project): Set<string> {
  return new Set([...p.blocks.map((b) => b.source), ...p.tracks.flatMap((t) => [...(t.frozen ? [t.frozen.source] : []), ...(t.instrument?.sample ? [t.instrument.sample] : [])])])
}

/** 波形ブロックが使う、元の音の範囲（秒） */
const rangeOf = (b: Block): [number, number] => [b.offset, b.offset + b.length * b.rate]

/**
 * 元の音を、波形ブロックが使う範囲（全ブロックの最小から最大まで。間は残す）だけにする。
 * ピッチカーブとピッチのエンベロープは元の音の時刻で持つので、切り落とした頭の分だけずらす
 */
function trimSources(p: Project): Project {
  const frozen = new Set(p.tracks.flatMap((t) => (t.frozen ? [t.frozen.source] : [])))
  const cut = new Map<string, { source: Source; from: number }>()
  for (const s of p.sources) {
    const blocks = p.blocks.filter((b) => b.source === s.id)
    // 使っていない音（あとで消すか残すかは別の設定）と、フリーズの音はそのまま
    if (!blocks.length || frozen.has(s.id)) continue
    const lo = Math.max(0, Math.min(...blocks.map((b) => rangeOf(b)[0])) - MARGIN)
    const hi = Math.min(s.duration, Math.max(...blocks.map((b) => rangeOf(b)[1])) + MARGIN)
    const rate = s.clip.sampleRate
    const a = Math.floor(lo * rate)
    const z = Math.min(s.clip.channels[0].length, Math.ceil(hi * rate))
    // ほとんど切れないなら、そのまま（複製と誤差を避ける）
    if (a <= 0 && z >= s.clip.channels[0].length) continue
    const clip = { sampleRate: rate, channels: s.clip.channels.map((c) => c.slice(a, z)) }
    cut.set(s.id, { source: { ...s, clip, duration: clip.channels[0].length / rate }, from: a / rate })
  }
  if (!cut.size) return p
  return {
    ...p,
    sources: p.sources.map((s) => cut.get(s.id)?.source ?? s),
    blocks: p.blocks.map((b) => {
      const c = cut.get(b.source)
      if (!c) return b
      return {
        ...b,
        offset: Math.max(0, b.offset - c.from),
        curve: b.curve && { ...b.curve, from: b.curve.from - c.from },
        pitchEnvelope: b.pitchEnvelope?.map((pt) => ({ ...pt, s: pt.s - c.from })),
      }
    }),
  }
}

/** 最適化したプロジェクトを作る（onProgress は 0〜1。確定が重いので、その進み具合を主にする） */
export async function optimizeProject(p: Project, o: OptimizeOptions, onProgress: (v: number) => void): Promise<Project> {
  let q = p
  if (o.bake !== 'none') {
    const mode = o.bake
    const ids = q.blocks.filter((b) => (!o.scope || o.scope.includes(b.id)) && !isNeutral(b, mode)).map((b) => b.id)
    const baked = await bakeBlocks(q, ids, (v) => onProgress(v * 0.9), mode)
    q = applyBaked(q, baked, mode)
  }
  if (o.trim) q = trimSources(q)
  if (o.dropUnused) {
    const used = usedSources(q)
    q = { ...q, sources: q.sources.filter((s) => used.has(s.id)) }
  }
  onProgress(1)
  return q
}
