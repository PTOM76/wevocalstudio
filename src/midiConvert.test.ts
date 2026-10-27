// midiConvert.ts のテスト（波形ブロック → MIDI ブロック → 波形ブロックの往復）
import { describe, expect, it, vi } from 'vitest'
import { midiToWaves, wavesToMidi } from './midiConvert'
import { midiBlocks, newProject, type Block, type Project } from './project'

// 音源の読み込みは使わない（画面の部品まで読み込まれる）
vi.mock('wevocal-lib', async (orig) => ({ ...(await orig<object>()), findInstrument: () => undefined }))

const block = (id: string, start: number, length: number, pitch = 0): Block =>
  ({ id, track: 't', source: 's', offset: 0, rate: 1, gain: 0, pitch, algorithm: 'auto', preserveFormant: false, formant: 0, fadeIn: 0, fadeOut: 0, mute: false, start, length }) as unknown as Block

const base = (): Project => {
  const p = newProject(120)
  return { ...p, tracks: [{ ...p.tracks[0], id: 't' }], blocks: [block('a', 1, 0.5), block('b', 2, 0.25, 2)] }
}

describe('波形ブロックから MIDI ブロック', () => {
  it('位置と長さを拍に、ピッチを音程にする', () => {
    const { project, id } = wavesToMidi(base(), ['a', 'b'], 'MIDI')
    const m = midiBlocks(project).find((b) => b.id === id)!
    // 120 BPM なので 1 秒 = 2 拍
    expect(m.start).toBe(1)
    expect(m.notes.map((n) => [n.t, n.dur, n.pitch])).toEqual([
      [0, 1, 60],
      [2, 0.5, 62],
    ])
    expect(project.tracks).toHaveLength(2)
    expect(project.blocks).toHaveLength(2)
  })

  it('選んでいなければ何もしない', () => {
    const p = base()
    expect(wavesToMidi(p, [], 'MIDI')).toEqual({ project: p, id: null })
  })
})

describe('MIDI ブロックから波形ブロック', () => {
  it('音符の位置に、音程の差だけピッチを変えて並べる', () => {
    const { project, id } = wavesToMidi(base(), ['a', 'b'], 'MIDI')
    const q = midiToWaves(project, id!, 'a', '並べた')
    const added = q.blocks.slice(2)
    expect(added.map((b) => [b.start, b.length, b.pitch])).toEqual([
      [1, 0.5, 0],
      [2, 0.25, 2],
    ])
    expect(q.tracks).toHaveLength(3)
  })
})
