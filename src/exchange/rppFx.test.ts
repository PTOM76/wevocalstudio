// rppFx.ts のテスト（REAPER の FX の塊の形。値は架空のもの）
import { describe, expect, it } from 'vitest'
import { fxLines, qToOctaves } from './rppFx'

const q = (s: string) => `"${s}"`
const bytes = (b64: string) => {
  const b = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  return new DataView(b.buffer)
}

describe('fxLines', () => {
  it('つまみの値の VST: 見出し、deadbeef の印と float、プリセットの名前', () => {
    const lines = fxLines({ kind: 'vst', on: false, name: 'Test Verb', file: 'Test Verb.dll', uniqueId: 0x41424344, params: [0.25, 0.5, 1] }, q)
    expect(lines[0]).toBe('BYPASS 1 0 0')
    expect(lines[1]).toBe('<VST "VST: Test Verb" "Test Verb.dll" 0 "" 1094861636<56535441424344746573747665726200> ""')
    const head = bytes(lines[2].trim())
    expect(head.byteLength).toBe(60)
    expect(head.getUint32(0, true)).toBe(0x41424344)
    expect(head.getUint32(4, true)).toBe(0xfeed5eef)
    expect(head.getUint32(48, true)).toBe(8 + 3 * 4)
    expect(head.getUint32(52, true)).toBe(0)
    const data = bytes(lines[3].trim())
    expect([data.getUint32(0, true), data.getUint32(4, true), data.getFloat32(8, true), data.getFloat32(16, true)]).toEqual([0xdeadbeef, 0xdeadf00d, 0.25, 1])
    expect(atob(lines[4].trim())).toBe('Default\0Default\0\x10\0\0\0')
    expect(lines.slice(5)).toEqual(['>', 'FLOATPOS 0 0 0 0', 'WAK 0 0'])
  })

  it('ReaEQ: 塊の印と、帯（種類 8、周波数、倍率、幅）', () => {
    const lines = fxLines({ kind: 'reaeq', on: true, bands: [{ freq: 1000, gain: 6, bw: 1 }] }, q)
    expect(lines[1]).toBe('<VST "VST: ReaEQ (Cockos)" "reaeq.dll" 0 "" 1919247729<56535472656571726561657100000000> ""')
    const head = bytes(lines[2].trim())
    expect(head.getUint32(4, true)).toBe(0xfeed5eee)
    expect(head.getUint32(52, true)).toBe(1)
    const d = bytes(lines[3].trim())
    expect([d.getUint32(0, true), d.getUint32(4, true), d.getUint32(8, true), d.getUint32(12, true)]).toEqual([0x21, 1, 8, 1])
    expect(d.getFloat64(16, true)).toBe(1000)
    expect(d.getFloat64(24, true)).toBeCloseTo(10 ** (6 / 20))
    expect(d.getFloat64(32, true)).toBe(1)
    expect(head.getUint32(48, true)).toBe(d.byteLength)
  })
})

describe('qToOctaves', () => {
  it('10 帯の Q（1.41）は約 1 オクターブ、31 帯の Q（4.32）は約 1/3 オクターブ', () => {
    expect(qToOctaves(1.41)).toBeCloseTo(1, 1)
    expect(qToOctaves(4.32)).toBeCloseTo(1 / 3, 2)
  })
})
