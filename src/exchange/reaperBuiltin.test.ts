// 組み込みの FX と REAPER の FX（JSFX、Rea 系の VST）の変換のテスト（値は架空のもの）
import { describe, expect, it } from 'vitest'
import { EQ_ID, type FxSlot } from 'wevocal-lib'
import { builtinToReaper, jsToBuiltin } from './reaperBuiltin'
import { fxLines } from './rppFx'

const slot = (plugin: string, values: Record<string, number>): FxSlot => ({ plugin, version: '1.0.0', on: true, values })
/** JSFX にして、書いた行を読み直し、Studio の値に戻す */
const roundTrip = (plugin: string, values: Record<string, number>, bpm = 120) => {
  const fx = builtinToReaper(slot(plugin, values), values, bpm, 'js')
  if (fx?.kind !== 'js') return null
  const line = fxLines(fx, (s) => `"${s}"`)[2].trim().split(' ')
  return jsToBuiltin({ ...fx, sliders: line.map((v) => (v === '-' ? undefined : parseFloat(v))) })
}

describe('JSFX への変換', () => {
  it('ディレイ: 時間、フィードバック、ミックスが戻る。拍の同期は ms にする', () => {
    const r = roundTrip('wevocal.delay', { sync: 0, time: 420, feedback: 0.5, tone: 8000, mix: 0.3 })!
    expect(r.plugin).toBe('wevocal.delay')
    expect(r.values.time).toBe(420)
    expect(r.values.feedback).toBeCloseTo(0.5, 3)
    expect(r.values.mix).toBeCloseTo(0.3, 3)
    // 120 BPM の 8 分音符は 250 ms
    expect(roundTrip('wevocal.delay', { sync: 2, time: 300, feedback: 0.3, mix: 0.2 })!.values.time).toBe(250)
  })

  it('コーラスは 2 声、アンサンブルは声の数を戻す', () => {
    expect(roundTrip('wevocal.chorus', { rate: 0.8, depth: 0.5, delay: 18, mix: 0.5 })!.plugin).toBe('wevocal.chorus')
    const e = roundTrip('wevocal.ensemble', { rate: 1.2, depth: 0.4, delay: 20, mix: 0.6, voices: 4, spread: 0.8 })!
    expect(e.plugin).toBe('wevocal.ensemble')
    expect(e.values.voices).toBe(4)
    expect(e.values.rate).toBeCloseTo(1.2)
  })

  it('コンプ、リミッター、ディエッサー、ゲート、ピッチの主な値が戻る', () => {
    expect(roundTrip('wevocal.compressor', { threshold: -20, ratio: 3, attack: 10, release: 200, knee: 6, makeup: 4 })!.values).toMatchObject({ threshold: -20, ratio: 3, makeup: 4, knee: 6 })
    expect(roundTrip('wevocal.limiter', { ceiling: -1.5, release: 120 })!.values).toMatchObject({ ceiling: -1.5, release: 120 })
    expect(roundTrip('wevocal.deesser', { freq: 6000, threshold: -30, ratio: 6, release: 60 })!.values).toMatchObject({ freq: 6000, threshold: -30, ratio: 6 })
    expect(roundTrip('wevocal.gate', { threshold: -45, range: -60, attack: 2, hold: 80, release: 90 })!.values).toMatchObject({ threshold: -45, attack: 2, release: 90 })
    expect(roundTrip('wevocal.pitch', { pitch: -7.25, formant: 0, keep: 1, algorithm: 0 })!.values.pitch).toBeCloseTo(-7.25)
    expect(roundTrip('wevocal.pitch', { pitch: 19, formant: 0, keep: 1, algorithm: 0 })!.values.pitch).toBeCloseTo(19)
  })

  it('フィルターはハイパスとローパスだけ。バンドパスは変換しない', () => {
    expect(roundTrip('wevocal.filter', { type: 0, freq: 120, q: 0.7, slope: 0 })!.values).toMatchObject({ type: 0, freq: 120 })
    expect(roundTrip('wevocal.filter', { type: 1, freq: 6000, q: 0.7, slope: 0 })!.values).toMatchObject({ type: 1, freq: 6000 })
    expect(builtinToReaper(slot('wevocal.filter', { type: 2, freq: 1000 }), { type: 2, freq: 1000 }, 120, 'js')).toBeNull()
  })

  it('リバーブは変換先が無い。EQ は優先によらず ReaEQ', () => {
    expect(builtinToReaper(slot('wevocal.reverb', { mix: 0.3 }), { mix: 0.3 }, 120, 'js')).toBeNull()
    const eq = { bands: 0, range: 0, b5: 3 }
    expect(builtinToReaper(slot(EQ_ID, eq), eq, 120, 'js')?.kind).toBe('reaeq')
    expect(builtinToReaper(slot(EQ_ID, eq), eq, 120, 'vst')?.kind).toBe('reaeq')
  })

  it('JSFX の行は 64 個の値で、無い番号は -', () => {
    const fx = builtinToReaper(slot('wevocal.limiter', { ceiling: -1, release: 100 }), { ceiling: -1, release: 100 }, 120, 'js')!
    const lines = fxLines(fx, (s) => `"${s}"`)
    expect(lines[1]).toBe('<JS loser/MGA_JSLimiter ""')
    const values = lines[2].trim().split(' ')
    expect(values).toHaveLength(64)
    expect(values.slice(0, 4)).toEqual(['0', '100', '-1', '-'])
  })
})
