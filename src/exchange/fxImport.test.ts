// REAPER の FX の読み込みのテスト（書いたものを読むと戻る、ReaEQ を WevEQ に、VST を導入済みのものに当てる。値は架空のもの）
import { describe, expect, it } from 'vitest'
import type { FxPlugin } from 'wevocal-lib'
import type { XProject } from './exchange'
import { reaeqToSlot, vstToSlot } from './fromExchange'
import { writeRpp } from './rpp'
import { readRpp } from './rppRead'

const project = (fx: NonNullable<XProject['tracks'][number]['fx']>): XProject => ({
  bpm: 120,
  beatsPerBar: 4,
  markers: [],
  tempos: [],
  master: { volume: 0, pan: 0, mute: false },
  tracks: [{ name: 't', volume: 0, pan: 0, mute: false, solo: false, invert: false, depth: 0, clips: [], midi: [], fx }],
  files: new Map(),
})

describe('REAPER の FX の読み込み', () => {
  it('書いた VST と ReaEQ を読むと戻る（オフも）', () => {
    const fx: NonNullable<XProject['tracks'][number]['fx']> = [
      { kind: 'vst', on: false, name: 'Test Verb', file: 'Test Verb.dll', uniqueId: 0x41424344, params: [0.25, 0.5, 1] },
      { kind: 'reaeq', on: true, bands: [{ freq: 1000, gain: 6, bw: 1 }] },
    ]
    const r = readRpp(writeRpp(project(fx)))
    expect(r.notes.skippedFx).toBe(0)
    const got = r.project.tracks[0].fx!
    expect(got[0]).toEqual(fx[0])
    expect(got[1].kind).toBe('reaeq')
    if (got[1].kind === 'reaeq') expect(got[1].bands[0].gain).toBeCloseTo(6)
  })

  it('塊でしか状態を持たない VST は塊のまま往復し、導入済みのものに当てると状態（base64）に入る', () => {
    const chunk = Uint8Array.from([1, 2, 3, 250])
    const r = readRpp(writeRpp(project([{ kind: 'vst', on: true, name: 'Chunky', file: 'chunky.dll', uniqueId: 9, params: [], chunk }])))
    const fx = r.project.tracks[0].fx![0]
    expect(fx.kind === 'vst' && Array.from(fx.chunk ?? [])).toEqual([1, 2, 3, 250])
    const plugin = { manifest: { id: 'vst.chunky', version: '1.0.0', format: 'vst', params: [{ id: 'p0', default: 0.5 }], vst: { file: 'chunky.dll', uniqueId: 9 } }, lang: {} } as unknown as FxPlugin
    if (fx.kind === 'vst') expect(vstToSlot(fx, [plugin])).toEqual({ plugin: 'vst.chunky', version: '1.0.0', on: true, values: { p0: 0.5 }, state: btoa(String.fromCharCode(1, 2, 3, 250)) })
  })

  it('ReaEQ の帯は、一番近い周波数の帯へ寄せる（幅が広ければ 10 帯）', () => {
    const s = reaeqToSlot({ kind: 'reaeq', on: true, bands: [{ freq: 1100, gain: 4, bw: 1 }, { freq: 120, gain: -15, bw: 1 }] })
    expect(s.values.bands).toBe(0)
    expect(s.values.b5).toBe(4)
    expect(s.values.b2).toBe(-15)
    expect(s.values.range).toBe(1)
  })

  it('VST は識別番号か DLL の名前で導入済みのものに当て、無ければ null', () => {
    const plugin = { manifest: { id: 'vst.test', version: '1.0.0', format: 'vst', params: [{ id: 'p0', default: 0 }, { id: 'p1', default: 0.3 }], vst: { file: 'test.dll', uniqueId: 7 } }, lang: { en_us: { name: 'Test' } } } as unknown as FxPlugin
    const fx = { kind: 'vst' as const, on: true, name: 'Other', file: 'TEST.DLL', uniqueId: 0, params: [0.9] }
    expect(vstToSlot(fx, [plugin])).toEqual({ plugin: 'vst.test', version: '1.0.0', on: true, values: { p0: 0.9, p1: 0.3 } })
    expect(vstToSlot({ ...fx, file: 'none.dll' }, [plugin])).toBeNull()
  })
})
