// mixCore.ts のテスト（声を足す計算と、声の差し替え）
import { describe, expect, it } from 'vitest'
import { FADE, mixInto, nextVoices, type ClipStore, type Live } from './mixCore'
import type { Voice } from './types'

const SR = 1000
const voice = (o: Partial<Voice> = {}): Voice => ({ key: 'a', sig: '1', t0: 0, t1: 1, clip: 1, f0: 0, bt0: 0, bt1: 1, fadeIn: 0, fadeOut: 0, joinIn: 0, joinOut: 0, level: 1, env: [], ...o })
const clips: ClipStore = new Map([[1, { sampleRate: SR, channels: [new Float32Array(2000).fill(0.5)] }]])
const mix = (live: Live[], t0: number, stoppedAt = 0) => {
  const L = new Float32Array(128)
  const R = new Float32Array(128)
  mixInto(live, clips, t0, SR, L, R, stoppedAt)
  return { L, R }
}

describe('mixInto', () => {
  it('モノラルの音を左右に足し、声の範囲の外は足さない', () => {
    const { L, R } = mix([{ v: voice({ t0: 0.05 }), bornAt: 0, diedAt: 0 }], 0)
    expect(L[10]).toBe(0)
    expect(L[100]).toBeCloseTo(0.5)
    expect(R[100]).toBeCloseTo(0.5)
  })

  it('音量のエンベロープ（点の間は直線）', () => {
    const { L } = mix([{ v: voice({ env: [0, 0, 0.128, 1] }), bornAt: 0, diedAt: 0 }], 0)
    expect(L[64]).toBeCloseTo(0.25, 2)
  })

  it('止めたら FADE で下げ、終わった声は捨てる', () => {
    const live: Live[] = [{ v: voice({ t1: 0.1 }), bornAt: 0, diedAt: 0 }]
    const { L } = mix(live, 0, 0.05)
    expect(L[127]).toBe(0)
    mix(live, 0.2)
    expect(live.length).toBe(0)
    expect(FADE).toBeGreaterThan(0)
  })
})

describe('nextVoices', () => {
  it('変わっていない声はそのまま、変わった声は消しながら新しい声を足す', () => {
    const a: Live = { v: voice(), bornAt: 0, diedAt: 0 }
    const same = nextVoices([a], [voice()], 0.5, true)
    expect(same).toEqual([a])
    const changed = nextVoices([a], [voice({ sig: '2' })], 0.5, true)
    expect(changed.length).toBe(2)
    expect(changed.find((l) => l.v.sig === '2')?.bornAt).toBe(0.5)
    expect(changed.find((l) => l.v.sig === '1')?.diedAt).toBe(0.5)
  })
})
