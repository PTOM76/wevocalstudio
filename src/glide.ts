// 選んだ波形ブロックの、前のピッチからなめらかにつなぐ（ポルタメント）。各波形ブロックの頭に、前の波形ブロックの終わりのピッチから自分のピッチへ戻るピッチのエンベロープを足す。画面を知らない
import { PITCH_ENV_MAX, pitchEnvAt, type Block, type EnvShape, type PitchPoint, type Project } from './project'

/** つなぐ長さの既定（秒。時間軸の上での長さ） */
export const GLIDE_SECONDS = 0.12

export type GlideShape = EnvShape

/** 波形ブロックの終わりのピッチ（半音。基本のピッチに、ピッチのエンベロープの終わりの値を足したもの） */
const endPitch = (b: Block) => b.pitch + pitchEnvAt(b.pitchEnvelope, b.offset + b.length * b.rate)

/**
 * 選んだ波形ブロックを、トラックごとに時間の順に並べ、2 つ目からは頭の `seconds` 秒をかけて、前の波形ブロックの終わりのピッチから自分のピッチへ動かす。形状とベジェの張り具合を指定する。
 * 長さの半分までにする。すでにあるピッチのエンベロープは、つなぐ区間より後の点を残す。ピッチのエンベロープの範囲（±12 半音）を超える差は範囲に収める
 */
export function glideBlocks(p: Project, ids: string[], seconds = GLIDE_SECONDS, shape: GlideShape = 'linear', tension = 0): Project {
  const chosen = p.blocks.filter((b) => ids.includes(b.id))
  const patched = new Map<string, Block>()
  for (const t of p.tracks) {
    const list = chosen.filter((b) => b.track === t.id).sort((a, b) => a.start - b.start)
    for (let i = 1; i < list.length; i++) {
      const b = list[i]
      // 前の波形ブロックは、さっきつないだ結果（終わりのピッチは変わらない）を使う
      const diff = endPitch(patched.get(list[i - 1].id) ?? list[i - 1]) - b.pitch
      const offset = Math.max(-PITCH_ENV_MAX, Math.min(PITCH_ENV_MAX, Math.round(diff * 100) / 100))
      if (Math.abs(offset) < 0.01) continue
      // 元の音の時刻にして持つ（分割や端の調整をしてもずれない）
      const end = b.offset + Math.min(seconds, b.length / 2) * b.rate
      // 前につないだ長さがあれば、その区間の点も置き換える（形状や長さを後から変えられる）
      const clearTo = Math.max(end, b.glide ? b.offset + b.glide * b.rate : -Infinity)
      const rest = (b.pitchEnvelope ?? []).filter((pt) => pt.s > clearTo)
      // 2 つの点と、最初の点が持つ形状で表す（点を増やして形を作らない）
      const points: PitchPoint[] = [{ s: b.offset, st: offset, ...(shape !== 'linear' ? { shape } : {}), ...(shape === 'bezier' ? { tension } : {}) }, { s: end, st: 0 }]
      points.push(...rest)
      patched.set(b.id, { ...b, pitchEnvelope: points, glide: Math.min(seconds, b.length / 2) })
    }
  }
  return patched.size ? { ...p, blocks: p.blocks.map((b) => patched.get(b.id) ?? b) } : p
}
