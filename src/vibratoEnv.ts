// 選んだ波形ブロックに、ビブラートをピッチのエンベロープとして足す。範囲があれば、その中だけ（波形ブロックの外は触らない）。画面を知らない
import type { Range } from 'wevocal-lib'
import { PITCH_ENV_MAX, pitchEnvAt, type Block, type EnvShape, type PitchPoint, type Project } from './project'

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
 * ids の波形ブロックの ピッチのエンベロープに、ビブラートを足す。その時間の元の点は置き換える。
 * 揺れは、山と谷を 1 つずつ点にして、点の間を slowStartEnd の形状でつなぐ（コサインの補間なのでほぼ正弦波。1 周期に点 2 つで済み、点の数も形も周期に左右されない）。
 * 今ある曲線は、点を置く位置（かかり始めの前と、山と谷）の値だけを引き継ぐ。点は元の音の時刻で持つ（分割や端の調整をしてもずれない）。±12 半音に収める
 */
export function vibratoBlocks(p: Project, ids: string[], range: Range | null, o: VibratoParams): Project {
  const patched = new Map<string, Block>()
  for (const b of p.blocks) {
    if (!ids.includes(b.id)) continue
    const span = spanOf(b, range)
    if (!span || o.rate <= 0) continue
    const [t0, t1] = span
    const len = t1 - t0
    // かかり始めが範囲の外なら、揺らさない
    const delay = Math.max(0, o.delay)
    if (delay >= len) continue
    const sOf = (t: number) => b.offset + (t - b.start) * b.rate
    const point = (at: number, swing: number, shape?: EnvShape): PitchPoint => {
      const s = sOf(t0 + at)
      const st = pitchEnvAt(b.pitchEnvelope, s) + swing
      return { s, st: Math.max(-PITCH_ENV_MAX, Math.min(PITCH_ENV_MAX, Math.round(st * 1000) / 1000)), ...(shape ? { shape } : {}) }
    }
    // 頭から、かかり始めの位置までは元の曲線のまま。そこから正弦波の 4 分の 1 周期で最初の山、あとは半周期ごとに谷と山
    const half = 1 / (2 * o.rate)
    const points: PitchPoint[] = [point(0, 0)]
    if (delay > 0) points.push(point(delay, 0, 'fastStart'))
    else points[0] = point(0, 0, 'fastStart')
    let sign = 1
    for (let at = delay + half / 2; at < len - 1e-6; at += half, sign = -sign) {
      const amp = o.depth * smooth((at - delay) / ATTACK) * smooth((len - at) / RELEASE)
      points.push(point(at, sign * amp, 'slowStartEnd'))
    }
    // 最後の山か谷から元の曲線へ戻る（4 分の 1 周期の下がり方）
    const last = points[points.length - 1]
    if (last.shape === 'slowStartEnd') last.shape = 'fastEnd'
    points.push(point(len, 0))
    const [s0, s1] = [sOf(t0), sOf(t1)]
    const kept = (b.pitchEnvelope ?? []).filter((pt) => pt.s < s0 || pt.s > s1)
    patched.set(b.id, { ...b, pitchEnvelope: [...kept, ...points].sort((a, c) => a.s - c.s) })
  }
  return patched.size ? { ...p, blocks: p.blocks.map((b) => patched.get(b.id) ?? b) } : p
}
