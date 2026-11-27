// rppRead.ts のテスト（rpp.ts で書いたものを読むと元に戻る、フォルダーの深さ、語の分け方）
import { describe, expect, it } from 'vitest'
import { PPQ, type XProject } from './exchange'
import { writeRpp } from './rpp'
import { readRpp, tokens } from './rppRead'

const x: XProject = {
  bpm: 128,
  beatsPerBar: 3,
  markers: [{ time: 4, name: 'サビ "A"' }],
  tempos: [{ time: 8, bpm: 140, beatsPerBar: 4 }],
  master: { volume: -3, pan: 0.25, mute: false },
  tracks: [
    { name: '親', volume: 0, pan: 0, mute: false, solo: false, invert: false, depth: 0, clips: [], midi: [] },
    {
      name: '子',
      volume: -6,
      pan: -0.5,
      mute: true,
      solo: true,
      invert: true,
      depth: 1,
      clips: [{ name: 'a', start: 1, length: 2, file: 'audio/a.wav', offset: 0.5, gain: -6, fadeIn: 0.01, fadeOut: 0.02, rate: 1.5, pitch: 2, mute: false }],
      midi: [{ name: 'm', start: 0, length: 2, mute: false, ticks: 4 * PPQ, events: [{ tick: 0, bytes: [0x90, 60, 127] }, { tick: PPQ, bytes: [0x80, 60, 0] }] }],
    },
    { name: '別', volume: 0, pan: 0, mute: false, solo: false, invert: false, depth: 0, clips: [], midi: [] },
  ],
  files: new Map(),
}

describe('readRpp', () => {
  it('書いたものを読むと元に戻る', () => {
    const { project } = readRpp(writeRpp(x))
    const near = (v: number) => Math.round(v * 1e6) / 1e6
    expect(project.bpm).toBe(128)
    expect(project.beatsPerBar).toBe(3)
    expect(project.markers).toEqual(x.markers)
    expect(project.tempos).toEqual(x.tempos)
    expect(near(project.master.volume)).toBe(-3)
    expect(project.tracks.map((t) => t.depth)).toEqual([0, 1, 0])
    const t = project.tracks[1]
    expect({ ...t, volume: near(t.volume), clips: t.clips.map((c) => ({ ...c, gain: near(c.gain) })) }).toEqual(x.tracks[1])
  })

  it('囲みの記号ごとに語を分ける', () => {
    expect(tokens(`NAME "a b" 'c "d"' \`e\` 1`)).toEqual(['NAME', 'a b', 'c "d"', 'e', '1'])
  })
})
