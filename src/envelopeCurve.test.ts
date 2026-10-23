// envelopeCurve.ts のテスト
import { describe, expect, it } from 'vitest'
import { envAt, mirrorShape, pitchEnvAt, shapeProgress } from './envelopeCurve'

describe('shapeProgress', () => {
  it('どの形も 0 で 0、1 で 1（矩形は 1 になる瞬間だけ 1）', () => {
    for (const shape of [undefined, 'linear', 'slowStartEnd', 'fastStart', 'fastEnd', 'bezier'] as const) {
      expect(shapeProgress(shape, 0)).toBeCloseTo(0)
      expect(shapeProgress(shape, 1)).toBeCloseTo(1)
    }
    expect(shapeProgress('square', 0.99)).toBe(0)
    expect(shapeProgress('square', 1)).toBe(1)
  })

  it('速い始まりは前半で先に進み、速い終わりは後半で追いつく', () => {
    expect(shapeProgress('fastStart', 0.5)).toBeGreaterThan(0.5)
    expect(shapeProgress('fastEnd', 0.5)).toBeLessThan(0.5)
    expect(shapeProgress('slowStartEnd', 0.5)).toBeCloseTo(0.5)
  })

  it('bezier の tension が正なら前半を速く、負なら遅くする', () => {
    expect(shapeProgress('bezier', 0.5, 0.8)).toBeGreaterThan(0.5)
    expect(shapeProgress('bezier', 0.5, -0.8)).toBeLessThan(0.5)
  })
})

describe('mirrorShape', () => {
  it('向きが逆になるので、速い始まりと速い終わりを入れ替え、tension の符号を逆にする', () => {
    expect(mirrorShape({ shape: 'fastStart' })).toEqual({ shape: 'fastEnd' })
    expect(mirrorShape({ shape: 'fastEnd' })).toEqual({ shape: 'fastStart' })
    expect(mirrorShape({ shape: 'bezier', tension: 0.5 })).toEqual({ shape: 'bezier', tension: -0.5 })
    expect(mirrorShape({})).toEqual({})
  })
})

describe('envAt', () => {
  it('点が無ければ 0 dB、外側は端の値、間は直線', () => {
    expect(envAt(undefined, 1)).toBe(0)
    expect(envAt([], 1)).toBe(0)
    const env = [{ t: 1, db: -6 }, { t: 3, db: -12 }]
    expect(envAt(env, 0)).toBe(-6)
    expect(envAt(env, 4)).toBe(-12)
    expect(envAt(env, 2)).toBeCloseTo(-9)
  })

  it('前の点の形状に従い、同じ時刻の点は後の値を使う', () => {
    expect(envAt([{ t: 0, db: 0, shape: 'square' }, { t: 2, db: -10 }], 1)).toBe(0)
    expect(envAt([{ t: 1, db: 0 }, { t: 1, db: -10 }], 1)).toBe(0)
    expect(envAt([{ t: 0, db: 0 }, { t: 1, db: -4 }, { t: 1, db: -8 }], 1)).toBeCloseTo(-4)
  })
})

describe('pitchEnvAt', () => {
  it('元の音の時刻 s の半音を、点の間は直線で返す', () => {
    const env = [{ s: 0, st: 0 }, { s: 2, st: 4 }]
    expect(pitchEnvAt(undefined, 1)).toBe(0)
    expect(pitchEnvAt(env, -1)).toBe(0)
    expect(pitchEnvAt(env, 1)).toBeCloseTo(2)
    expect(pitchEnvAt(env, 9)).toBe(4)
  })
})
