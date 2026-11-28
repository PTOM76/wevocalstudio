// trackStream.ts のテスト（SDK の見本の processor を通した 1 本のトラックの計算）
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { installScope, loadProcessorSource, QUANTUM } from 'wevocal-lib/stream'
import type { ClipStore } from '../mixer/mixCore'
import type { Voice } from '../mixer/types'
import { TrackStream, type StreamSlot } from './trackStream'

const SR = 48000
const voice: Voice = { key: 'a', sig: '1', t0: 0, t1: 10, clip: 1, f0: 0, bt0: 0, bt1: 10, fadeIn: 0, fadeOut: 0, joinIn: 0, joinOut: 0, level: 1, env: [] }
const clips: ClipStore = new Map([[1, { sampleRate: SR, channels: [new Float32Array(SR * 10).fill(0.25)] }]])
const slot = (o: Partial<StreamSlot> = {}): StreamSlot => ({
  key: 'gain@1',
  name: 'wevocal-fx-example-gain',
  params: [{ id: 'gain', name: 'gain', min: -24, max: 24, default: 0 }],
  values: { gain: 6 },
  on: true,
  options: {},
  ...o,
})
const run = (s: TrackStream, frame: number) => {
  const L = new Float32Array(QUANTUM)
  const R = new Float32Array(QUANTUM)
  s.render(frame, L, R)
  return { L, R }
}
const db6 = 10 ** (6 / 20)

describe('TrackStream', () => {
  beforeAll(() => {
    installScope(SR)
    loadProcessorSource(readFileSync(new URL('../../../wevocalsynth/wevocal-lib/plugin-sdk/template-processor/src/processor.js', import.meta.url), 'utf8'))
  })

  it('声を足し、音量と processor を通す', () => {
    const s = new TrackStream(SR, clips)
    s.setVoices([voice], 0, false)
    s.setGain(0.5)
    s.setSlots([slot()])
    expect(run(s, 0).L[10]).toBeCloseTo(0.25 * 0.5 * db6)
  })

  it('子のトラックの音を、子のパンを掛けて親の声に混ぜ、親の音量と processor を通す', () => {
    const s = new TrackStream(SR, clips)
    s.setGain(0.5)
    s.setSlots([slot()])
    // 子: 自分の声（0.25）、音量 1、パン 0（真ん中は左右とも 1 倍。StereoPannerNode と同じ）
    s.setKids([{ gain: 1, pan: 0, slots: [], voices: [voice], kids: [] }], 0, false)
    const mid = run(s, 0)
    expect(mid.L[10]).toBeCloseTo(0.25 * 0.5 * db6)
    expect(mid.R[10]).toBeCloseTo(0.25 * 0.5 * db6)
    // パン -1 は、右の音も左へ寄せる（左 0.5、右 0）
    s.setKids([{ gain: 1, pan: -1, slots: [], voices: [voice], kids: [] }], 0, false)
    const left = run(s, QUANTUM)
    expect(left.L[10]).toBeCloseTo(0.5 * 0.5 * db6)
    expect(left.R[10]).toBeCloseTo(0)
  })

  it('オートメーション（曲の時刻の値）', () => {
    const s = new TrackStream(SR, clips)
    s.setVoices([voice], 0, false)
    s.setSlots([slot({ auto: { gain: [{ t: 0, v: 0 }, { t: 1, v: 0 }] } })])
    expect(run(s, SR / 2).L[0]).toBeCloseTo(0.25)
  })

  it('プラグインが知らせた状態を伝え、変わった状態だけをプラグインに渡す', async () => {
    loadProcessorSource(`
      class St extends AudioWorkletProcessor {
        constructor(o) {
          super(o)
          this.port.onmessage = (e) => this.port.postMessage({ __wevocalState: 'got:' + e.data.__wevocalSetState })
          this.port.postMessage({ __wevocalState: 'hello' })
        }
        process() { return true }
      }
      registerProcessor('state-proc', St)
    `)
    const s = new TrackStream(SR, clips)
    const got: [number, string][] = []
    s.onState = (i, st) => got.push([i, st])
    const st = (state?: string) => slot({ key: 'st@1', name: 'state-proc', params: [], values: {}, options: { state } })
    s.setSlots([st('a')])
    await new Promise((r) => setTimeout(r, 20))
    expect(got).toEqual([[0, 'hello']])
    // プラグインが知らせた値が戻ってきただけなら渡さない
    s.setSlots([st('hello')])
    s.setSlots([st('b')])
    await new Promise((r) => setTimeout(r, 20))
    expect(got).toEqual([
      [0, 'hello'],
      [0, 'got:b'],
    ])
  })

  it('オフからオンに戻すと、processor に読み込み直しを知らせる（止まって素通しになった VST を戻すため）', async () => {
    loadProcessorSource(`
      class Retry extends AudioWorkletProcessor {
        constructor(o) {
          super(o)
          this.port.onmessage = (e) => { if (e.data.__wevocalRetry) this.port.postMessage({ __wevocalState: 'retry' }) }
        }
        process() { return true }
      }
      registerProcessor('retry-proc', Retry)
    `)
    const s = new TrackStream(SR, clips)
    const got: string[] = []
    s.onState = (_i, st) => got.push(st)
    const r = (on: boolean) => slot({ key: 'retry@1', name: 'retry-proc', params: [], values: {}, on })
    s.setSlots([r(true)])
    s.setSlots([r(true)])
    await new Promise((res) => setTimeout(res, 20))
    expect(got).toEqual([])
    s.setSlots([r(false)])
    s.setSlots([r(true)])
    await new Promise((res) => setTimeout(res, 20))
    expect(got).toEqual(['retry'])
  })

  it('オフにすると、ならしながら素通しになる。同じ並びなら processor を作り直さない', () => {
    const s = new TrackStream(SR, clips)
    s.setVoices([voice], 0, false)
    s.setSlots([slot()])
    run(s, 0)
    s.setSlots([slot({ on: false })])
    let out = run(s, QUANTUM)
    for (let f = 2; f < 200; f++) out = run(s, f * QUANTUM)
    expect(out.L[0]).toBeCloseTo(0.25, 4)
  })
})
