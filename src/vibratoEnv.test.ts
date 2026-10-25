// vibratoEnv.ts のテスト
import { describe, expect, it } from 'vitest'
import { newProject, pitchEnvAt, type Block, type Project } from './project'
import { vibratoBlocks } from './vibratoEnv'

const block = (o: Partial<Block> = {}): Block => ({ id: 'b', track: 't', source: 's', start: 0, offset: 0, length: 2, rate: 1, gain: 0, pitch: 0, formant: 0, algorithm: 'sola3', preserveFormant: true, fadeIn: 0, fadeOut: 0, mute: false, ...o })
const project = (b: Block): Project => ({ ...newProject(), blocks: [b] })

describe('vibratoBlocks', () => {
  it('1 周期に点が 2 つで、点の間は slowStartEnd でつなぐ', () => {
    const p = vibratoBlocks(project(block()), ['b'], null, { depth: 1, rate: 5, delay: 0 })
    const env = p.blocks[0].pitchEnvelope ?? []
    // 2 秒 × 5 Hz = 10 周期。点は頭と終わり、山と谷 20 個
    expect(env.length).toBeLessThanOrEqual(24)
    expect(env.slice(1, -1).every((pt) => pt.shape === 'slowStartEnd' || pt.shape === 'fastEnd')).toBe(true)
  })

  it('深さに達したあとの山と谷は ±depth で、間は正弦波に近い', () => {
    const p = vibratoBlocks(project(block({ length: 4 })), ['b'], null, { depth: 1, rate: 4, delay: 0 })
    const env = p.blocks[0].pitchEnvelope
    // 4 Hz は 1 周期 0.25 秒。山は 0.0625 + 0.25n、谷は 0.1875 + 0.25n
    expect(pitchEnvAt(env, 1.0625)).toBeCloseTo(1, 2)
    expect(pitchEnvAt(env, 1.1875)).toBeCloseTo(-1, 2)
    // 山と谷の真ん中は 0 に近い
    expect(Math.abs(pitchEnvAt(env, 1.125))).toBeLessThan(0.05)
  })

  it('かかり始めの前は揺れない', () => {
    const p = vibratoBlocks(project(block()), ['b'], null, { depth: 1, rate: 5, delay: 0.5 })
    const env = p.blocks[0].pitchEnvelope
    for (const s of [0, 0.2, 0.4, 0.5]) expect(pitchEnvAt(env, s)).toBeCloseTo(0, 5)
  })

  it('範囲があれば、その外の点は触らない', () => {
    const before = block({ pitchEnvelope: [{ s: 0.1, st: 2 }, { s: 1.9, st: -2 }] })
    const p = vibratoBlocks(project(before), ['b'], { start: 0.5, end: 1.5 }, { depth: 1, rate: 5, delay: 0 })
    const env = p.blocks[0].pitchEnvelope ?? []
    expect(env.some((pt) => pt.s === 0.1 && pt.st === 2)).toBe(true)
    expect(env.some((pt) => pt.s === 1.9 && pt.st === -2)).toBe(true)
  })

  it('±12 半音に収める', () => {
    const p = vibratoBlocks(project(block({ pitchEnvelope: [{ s: 0, st: 12 }] })), ['b'], null, { depth: 5, rate: 5, delay: 0 })
    expect((p.blocks[0].pitchEnvelope ?? []).every((pt) => Math.abs(pt.st) <= 12)).toBe(true)
  })

  it('かかり始めが長さ以上なら何もしない', () => {
    const p0 = project(block())
    expect(vibratoBlocks(p0, ['b'], null, { depth: 1, rate: 5, delay: 5 })).toBe(p0)
  })
})
