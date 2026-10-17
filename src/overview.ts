// ミニマップ用の、全トラックを重ねた小さな音（1 秒 1000 点の振幅）。元の音は書き換えず、波形ブロックの位置と音量から作る
import type { Clip } from 'wevocal-lib'
import { peakRange } from './peaks'
import { dbToGain, projectEnd, type Block, type Project, type Source } from './project'

const RATE = 1000

/** 波形ブロックごとの振幅の列（Block は書き換えずに作り直すので、同じオブジェクトなら同じ値。変えたブロックだけ作り直す） */
const perBlock = new WeakMap<Block, Float32Array>()

function blockLevels(b: Block, source: Source): Float32Array {
  let out = perBlock.get(b)
  if (out) return out
  const { clip } = source
  const gain = dbToGain(b.gain)
  // 1 点に入る元の音のサンプル数。波形と同じ前もって作ったピーク（peaks.ts）から大きさを取る（毎回サンプルを走査しない）
  const per = (clip.sampleRate * b.rate) / RATE
  const pk = { lo: 0, hi: 0 }
  out = new Float32Array(Math.floor(b.length * RATE))
  for (let k = 0; k < out.length; k++) {
    const a = Math.floor(b.offset * clip.sampleRate + k * per)
    peakRange(clip, a, Math.floor(a + per) + 1, per, pk)
    out[k] = Math.max(pk.hi, -pk.lo) * gain
  }
  perBlock.set(b, out)
  return out
}

export function buildOverview(p: Project): { clip: Clip; duration: number } {
  const duration = Math.max(1, projectEnd(p))
  const out = new Float32Array(Math.ceil(duration * RATE))
  const sources = new Map(p.sources.map((s) => [s.id, s]))
  for (const b of p.blocks) {
    const source = sources.get(b.source)
    if (!source || b.mute) continue
    const levels = blockLevels(b, source)
    const first = Math.floor(b.start * RATE)
    const n = Math.min(levels.length, out.length - first)
    for (let k = 0; k < n; k++) if (levels[k] > out[first + k]) out[first + k] = levels[k]
  }
  // 上下対称に描かれるよう、正と負を交互に置く（Minimap は最小と最大で描く）
  for (let i = 1; i < out.length; i += 2) out[i] = -out[i]
  return { clip: { sampleRate: RATE, channels: [out] }, duration }
}
