// 選んだ波形ブロックに、ビブラートをピッチのエンベロープとして足す。範囲があれば、その中だけ（波形ブロックの外は触らない）。画面を知らない
import type { Range } from 'wevocal-lib'
import { PITCH_ENV_MAX, pitchEnvAt, type Block, type PitchPoint, type Project } from './project'

/** ビブラートの設定（wevocal-lib の VibratoOptions と同じ） */
export interface VibratoParams {
  /** 深さ（半音、片側の振れ幅） */
  depth: number
  /** 速さ（Hz） */
  rate: number
  /** かかり始めの遅れ（秒） */
  delay: number
}

/** 揺れが深さに達するまでと、終わりで消えるまでの長さ（秒） */
const ATTACK = 0.2
const RELEASE = 0.1
/** 1 周期に打つ点の数 */
const PER_CYCLE = 8

const smooth = (x: number) => {
  const c = Math.max(0, Math.min(1, x))
  return c * c * (3 - 2 * c)
}

/** 波形ブロックの、範囲にかかる時間（プロジェクトの秒）。かからなければ null */
function spanOf(b: Block, range: Range | null): [number, number] | null {
  const t0 = Math.max(b.start, range?.start ?? b.start)
  const t1 = Math.min(b.start + b.length, range?.end ?? b.start + b.length)
  return t1 - t0 > 0.05 ? [t0, t1] : null
}

/**
 * ids の波形ブロックの ピッチのエンベロープに、ビブラートを足す。今ある曲線の上に揺れを重ね、その時間の元の点は置き換える。
 * 点は元の音の時刻で持つ（分割や端の調整をしてもずれない）。±12 半音に収める
 */
export function vibratoBlocks(p: Project, ids: string[], range: Range | null, o: VibratoParams): Project {
  const patched = new Map<string, Block>()
  for (const b of p.blocks) {
    if (!ids.includes(b.id)) continue
    const span = spanOf(b, range)
    if (!span) continue
    const [t0, t1] = span
    const len = t1 - t0
    const sOf = (t: number) => b.offset + (t - b.start) * b.rate
    const step = 1 / (o.rate * PER_CYCLE)
    const points: PitchPoint[] = []
    for (let x = 0; ; x += step) {
      const at = Math.min(len, x)
      const env = smooth((at - o.delay) / ATTACK) * smooth((len - at) / RELEASE)
      const s = sOf(t0 + at)
      const st = pitchEnvAt(b.pitchEnvelope, s) + o.depth * env * Math.sin(2 * Math.PI * o.rate * Math.max(0, at - o.delay))
      points.push({ s, st: Math.max(-PITCH_ENV_MAX, Math.min(PITCH_ENV_MAX, Math.round(st * 1000) / 1000)) })
      if (at >= len) break
    }
    const [s0, s1] = [sOf(t0), sOf(t1)]
    const kept = (b.pitchEnvelope ?? []).filter((pt) => pt.s < s0 || pt.s > s1)
    patched.set(b.id, { ...b, pitchEnvelope: [...kept, ...points].sort((a, c) => a.s - c.s) })
  }
  return patched.size ? { ...p, blocks: p.blocks.map((b) => patched.get(b.id) ?? b) } : p
}
