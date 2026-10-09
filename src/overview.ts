// ミニマップ用の、全トラックを重ねた小さな音（1 秒 1000 点の振幅）。元の音は書き換えず、波形ブロックの位置と音量から作る
import type { Clip } from 'wevocal-lib'
import { dbToGain, projectEnd, type Project } from './project'

const RATE = 1000

export function buildOverview(p: Project): { clip: Clip; duration: number } {
  const duration = Math.max(1, projectEnd(p))
  const out = new Float32Array(Math.ceil(duration * RATE))
  for (const b of p.blocks) {
    const source = p.sources.find((s) => s.id === b.source)
    if (!source || b.mute) continue
    const { clip } = source
    const data = clip.channels[0]
    const gain = dbToGain(b.gain)
    // 1 点に入る元の音のサンプル数。全部は見ず、間引いて大きさだけを取る
    const per = (clip.sampleRate * b.rate) / RATE
    const stride = Math.max(1, Math.floor(per / 16))
    const first = Math.floor(b.start * RATE)
    const count = Math.floor(b.length * RATE)
    for (let k = 0; k < count && first + k < out.length; k++) {
      const a = Math.floor(b.offset * clip.sampleRate + k * per)
      let m = 0
      for (let i = a; i < a + per && i < data.length; i += stride) m = Math.max(m, Math.abs(data[i]))
      out[first + k] = Math.max(out[first + k], m * gain)
    }
  }
  // 上下対称に描かれるよう、正と負を交互に置く（Minimap は最小と最大で描く）
  for (let i = 1; i < out.length; i += 2) out[i] = -out[i]
  return { clip: { sampleRate: RATE, channels: [out] }, duration }
}
