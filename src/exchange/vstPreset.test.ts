// VST のプリセットのファイル（.fxp、.vstpreset）の形
import { describe, expect, it } from 'vitest'
import { fxp, vstPreset } from './vstPreset'
import { writeDawproject } from './dawproject'
import type { XProject } from './exchange'

const text = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n))

describe('vstPreset', () => {
  it('.fxp はつまみの値を big endian で並べる', () => {
    const b = fxp({ kind: 'vst', on: true, name: 'T', file: 't.dll', uniqueId: 0x41424344, params: [0.5, 1] })
    const v = new DataView(b.buffer)
    expect([text(b, 0, 4), text(b, 8, 4), v.getInt32(4), v.getUint32(16), v.getInt32(24), v.getFloat32(56), v.getFloat32(60)]).toEqual(['CcnK', 'FxCk', b.length - 8, 0x41424344, 2, 0.5, 1])
  })

  it('.fxp は塊があれば FPCh にする', () => {
    const b = fxp({ kind: 'vst', on: true, name: 'T', file: 't.dll', uniqueId: 1, params: [], chunk: Uint8Array.of(9, 8, 7) })
    expect([text(b, 8, 4), new DataView(b.buffer).getInt32(56), [...b.subarray(60)]]).toEqual(['FPCh', 3, [9, 8, 7]])
  })

  it('.vstpreset は状態を Comp と Cont に分け、一覧から指す', () => {
    // 長さ 2 の音の処理の状態と、長さ 1 のコントローラーの状態
    const state = Uint8Array.of(2, 0, 0, 0, 0xaa, 0xbb, 1, 0, 0, 0, 0xcc)
    const b = vstPreset('0123456789abcdef0123456789ABCDEF', state)
    const v = new DataView(b.buffer)
    const list = Number(v.getBigInt64(40, true))
    expect([text(b, 0, 4), v.getInt32(4, true), text(b, 8, 32), text(b, list, 4), v.getInt32(list + 4, true)]).toEqual(['VST3', 1, '0123456789ABCDEF0123456789ABCDEF', 'List', 2])
    const entry = (i: number) => [text(b, list + 8 + i * 20, 4), [...b.subarray(Number(v.getBigInt64(list + 12 + i * 20, true)), Number(v.getBigInt64(list + 12 + i * 20, true)) + Number(v.getBigInt64(list + 20 + i * 20, true)))]]
    expect([entry(0), entry(1)]).toEqual([
      ['Comp', [0xaa, 0xbb]],
      ['Cont', [0xcc]],
    ])
  })

  it('DAWproject は VST をトラックの Devices に書き、プリセットを zip に入れる', () => {
    const p: XProject = {
      bpm: 120,
      beatsPerBar: 4,
      markers: [],
      tempos: [],
      files: new Map(),
      tracks: [
        {
          name: 'A',
          volume: 0,
          pan: 0,
          mute: false,
          solo: false,
          invert: false,
          depth: 0,
          clips: [],
          midi: [],
          fx: [
            { kind: 'vst', on: true, name: 'Two', file: 'two.dll', uniqueId: 5, params: [0.1] },
            { kind: 'vst', on: false, name: 'Three', file: 'three.vst3', uniqueId: 6, params: [], cid: 'AB'.repeat(16), chunk: Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 0) },
          ],
        },
      ],
    } as unknown as XProject
    const xml = writeDawproject(p, { name: 'x', version: '1' })
    expect(xml).toContain('<Vst2Plugin deviceID="5" deviceName="Two" deviceRole="audioFX"')
    expect(xml).toContain(`<Vst3Plugin deviceID="${'AB'.repeat(16)}" deviceName="Three"`)
    expect(xml).toContain('<State path="plugins/2.vstpreset"/>')
    expect([...p.files.keys()]).toEqual(['plugins/1.fxp', 'plugins/2.vstpreset'])
  })
})
