// edits/blocks.ts のテスト
import { describe, expect, it } from 'vitest'
import { fillBlock, newProject, type Block, type InstrumentSlot, type MidiBlock, type Project, type Source } from '../../project'
import { PITCH_MAX, addEmptyMidi, addMidiBlocks, insertBlocks, nudgePitch, patchBlocks, patchMidiBlocks, removeBlocks, splitAt, splitBySilence } from './blocks'

const clip = (seconds: number, sampleRate = 100) => ({ sampleRate, channels: [new Float32Array(seconds * sampleRate)] })
const source = (id: string, seconds = 10): Source => ({ id, name: id, clip: clip(seconds), duration: seconds })
const block = (id: string, patch: Partial<Block> = {}): Block => fillBlock({ id, track: 't', source: 's', start: 0, offset: 0, length: 4, ...patch })
const midi = (id: string, patch: Partial<MidiBlock> = {}): MidiBlock => ({ id, track: 't', start: 0, length: 4, unit: 'beat', notes: [], mute: false, ...patch })
const base = (patch: Partial<Project> = {}): Project => ({ ...newProject(), sources: [source('s')], blocks: [block('a'), block('b')], ...patch })
const synth: InstrumentSlot = { plugin: 'test.synth', values: {} }

describe('removeBlocks', () => {
  it('波形ブロックと MIDI ブロックの両方から消す', () => {
    const p = removeBlocks(base({ midi: [midi('m'), midi('n')] }), ['a', 'm'])
    expect(p.blocks.map((b) => b.id)).toEqual(['b'])
    expect(p.midi?.map((b) => b.id)).toEqual(['n'])
  })

  it('MIDI ブロックの無いプロジェクトに midi を作らない', () => {
    expect('midi' in removeBlocks(base(), ['a'])).toBe(false)
  })
})

describe('patchBlocks', () => {
  it('指定した波形ブロックだけを変え、ほかは同じものを返す', () => {
    const p = base()
    const q = patchBlocks(p, { a: { gain: -6 } })
    expect(q.blocks[0].gain).toBe(-6)
    expect(q.blocks[1]).toBe(p.blocks[1])
  })
})

describe('patchMidiBlocks と addMidiBlocks', () => {
  it('MIDI ブロックを足して変える', () => {
    const p = patchMidiBlocks(addMidiBlocks(base(), [midi('m'), midi('n')]), { n: { start: 2 } })
    expect(p.midi?.map((b) => [b.id, b.start])).toEqual([['m', 0], ['n', 2]])
  })
})

describe('addEmptyMidi', () => {
  it('2 小節の長さで足し、音源がなければ付ける', () => {
    const p = base({ tracks: [{ ...newProject().tracks[0], id: 't' }] })
    const q = addEmptyMidi(p, 'm', 't', -3, () => synth)
    const m = q.midi![0]
    expect(m.length).toBeCloseTo((4 * 60 * 2) / p.tempo.bpm)
    expect(m.start).toBe(0)
    expect(q.tracks[0].instrument).toBe(synth)
  })

  it('音源があるトラックは変えず、無いトラックには何もしない', () => {
    const own: InstrumentSlot = { plugin: 'own', values: {} }
    const p = base({ tracks: [{ ...newProject().tracks[0], id: 't', instrument: own }] })
    expect(addEmptyMidi(p, 'm', 't', 1, () => synth).tracks[0].instrument).toBe(own)
    expect(addEmptyMidi(p, 'm', 'none', 1, () => synth)).toBe(p)
  })
})

describe('insertBlocks', () => {
  it('元の音がもう無いものは置かない', () => {
    const q = insertBlocks(base(), [block('c'), block('d', { source: 'gone' })])
    expect(q.blocks.map((b) => b.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('nudgePitch', () => {
  it('半音ずつ変え、小数は 0.01 に丸める', () => {
    const q = nudgePitch(base({ blocks: [block('a', { pitch: 0.1 })] }), ['a'], 0.204)
    expect(q.blocks[0].pitch).toBe(0.3)
  })

  it('範囲を超えず、null で 0 に戻す', () => {
    const p = base({ blocks: [block('a', { pitch: PITCH_MAX - 1 }), block('b', { pitch: 5 })] })
    expect(nudgePitch(p, ['a'], 10).blocks[0].pitch).toBe(PITCH_MAX)
    expect(nudgePitch(p, ['b'], null).blocks[1].pitch).toBe(0)
    expect(nudgePitch(p, ['a'], 1).blocks[1]).toBe(p.blocks[1])
  })
})

describe('splitAt', () => {
  it('t にかかる波形ブロックを分け、かからないものは残す', () => {
    const p = base({ blocks: [block('a', { start: 0, length: 4 }), block('b', { start: 10, length: 2 })] })
    const q = splitAt(p, 1, [], 0.01)
    expect(q.blocks.map((b) => [b.start, b.length])).toEqual([[0, 1], [1, 3], [10, 2]])
    expect(q.blocks[1].offset).toBeCloseTo(1)
  })

  it('ids を渡すと、そのブロックだけを分ける', () => {
    const p = base({ blocks: [block('a', { length: 4 }), block('b', { length: 4 })] })
    expect(splitAt(p, 1, ['b'], 0.01).blocks.map((b) => b.id).slice(0, 2)).toEqual(['a', 'b'])
    expect(splitAt(p, 1, ['b'], 0.01).blocks).toHaveLength(3)
  })

  it('MIDI ブロックも分け、またぐ音符は前では切り、後ろでは残りで続ける', () => {
    const m = midi('m', { length: 4, notes: [{ id: 'n', t: 0, dur: 6, pitch: 60, vel: 100 } as never] })
    const q = splitAt(base({ midi: [m] }), 2, [], 0.01)
    expect(q.midi).toHaveLength(2)
    expect(q.midi![0].length).toBeCloseTo(2)
    expect(q.midi![0].notes[0].dur).toBeGreaterThan(0)
    expect(q.midi![0].notes[0].dur).toBeCloseTo(4)
    expect(q.midi![1].notes[0].dur).toBeCloseTo(2)
  })
})

describe('splitBySilence', () => {
  it('音のない波形ブロックはそのまま、選んでいないものも触らない', () => {
    const p = base()
    const q = splitBySilence(p, ['a'], 0.01)
    expect(q.blocks[0]).toBe(p.blocks[0])
    expect(q.blocks[1]).toBe(p.blocks[1])
  })

  it('音のあるところだけを残し、片方に元の id を残す', () => {
    const data = new Float32Array(1000)
    // 0.2 秒〜0.6 秒と、2.0 秒〜2.5 秒に音（100Hz のサンプルレート。無音の隙間は 200ms より長い）
    for (let i = 20; i < 60; i++) data[i] = 0.5
    for (let i = 200; i < 250; i++) data[i] = 0.5
    const s: Source = { id: 's', name: 's', clip: { sampleRate: 100, channels: [data] }, duration: 10 }
    const q = splitBySilence(base({ sources: [s], blocks: [block('a', { length: 10 })] }), ['a'], 0.01)
    expect(q.blocks.map((b) => b.id)[0]).toBe('a')
    expect(q.blocks.length).toBe(2)
    expect(q.blocks[0].start).toBeCloseTo(0.2, 1)
    expect(q.blocks[1].start).toBeCloseTo(2.0, 1)
  })
})
