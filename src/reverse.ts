// 選んだ波形ブロックの逆再生。元の音は書き換えず、ブロックが使っている部分を逆にした新しい元の音を足して、ブロックをそちらに向ける。画面を知らない
import { CURVE_HOP, mirrorShape, newId, type Block, type Project, type Shaped, type Source } from './project'

/** 点の並びを裏返す。区間の形状は点が持つので、並びを逆にしたあとは、区間の向きに合わせて持たせ直す */
function flipPoints<T extends Shaped>(pts: T[] | undefined, flip: (pt: T) => T): T[] | undefined {
  if (!pts) return undefined
  const rev = pts.map(flip).reverse()
  return rev.map((pt, i) => {
    const { shape: _s, tension: _t, ...rest } = pt
    return { ...rest, ...(i < rev.length - 1 ? mirrorShape(pts[pts.length - 2 - i]) : {}) } as T
  })
}

/** 逆にしたブロックの値（新しい元の音は頭からブロックの使う分だけ。ピッチと音量の曲線は時間を裏返す。フェードの頭と終わりは入れ替える） */
function reversedBlock(b: Block, source: Source): Block {
  const segSec = b.length * b.rate
  // 元の音の時刻を、使う部分の終わりから数え直した時刻にする
  const flip = (s: number) => b.offset + segSec - s
  return {
    ...b,
    source: source.id,
    offset: 0,
    fadeIn: b.fadeOut,
    fadeOut: b.fadeIn,
    envelope: flipPoints(b.envelope, (pt) => ({ ...pt, t: b.length - pt.t })),
    pitchEnvelope: flipPoints(b.pitchEnvelope, (pt) => ({ ...pt, s: flip(pt.s) })),
    curve: b.curve && { from: flip(b.curve.from + b.curve.st.length * CURVE_HOP), st: [...b.curve.st].reverse() },
  }
}

/** ids の波形ブロックを逆再生にする（もう一度かけると元に戻る）。元の音が見つからないブロックは飛ばす */
export function reverseBlocks(p: Project, ids: string[]): Project {
  const sources: Source[] = []
  const blocks = p.blocks.map((b) => {
    const src = ids.includes(b.id) ? p.sources.find((s) => s.id === b.source) : undefined
    if (!src) return b
    const { sampleRate, channels } = src.clip
    const from = Math.max(0, Math.floor(b.offset * sampleRate))
    const to = Math.min(channels[0].length, Math.ceil((b.offset + b.length * b.rate) * sampleRate))
    if (to - from < 1) return b
    const reversed = channels.map((ch) => ch.slice(from, to).reverse())
    const source: Source = { id: newId(), name: src.name, clip: { sampleRate, channels: reversed }, duration: reversed[0].length / sampleRate }
    sources.push(source)
    return reversedBlock(b, source)
  })
  return sources.length ? { ...p, sources: [...p.sources, ...sources], blocks } : p
}
