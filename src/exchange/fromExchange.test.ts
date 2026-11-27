// fromExchange.ts のテスト（深さから親を決める、見つからない音声の仮の音、テンポの変化をマーカーに、割り当て）
import { describe, expect, it } from 'vitest'
import { assignAudio, fromExchange, matchAudio } from './fromExchange'
import type { XProject, XTrack } from './exchange'

const track = (name: string, depth: number, o: Partial<XTrack> = {}): XTrack => ({ name, volume: 0, pan: 0, mute: false, solo: false, invert: false, depth, clips: [], midi: [], ...o })
const clip = { name: 'a', start: 1, length: 2, file: 'audio/a.wav', offset: 0.5, gain: 0, fadeIn: 0, fadeOut: 0, rate: 1, pitch: 0, mute: false }
const x: XProject = {
  bpm: 100,
  beatsPerBar: 3,
  markers: [{ time: 4, name: 'A' }],
  tempos: [
    { time: 4, bpm: 90, beatsPerBar: 3 },
    { time: 8, bpm: 80, beatsPerBar: 4 },
  ],
  master: { volume: 0, pan: 0, mute: false },
  tracks: [track('親', 0), track('子', 1, { clips: [clip] }), track('孫', 2), track('別', 0)],
  files: new Map(),
}

describe('fromExchange', () => {
  const { project, missing } = fromExchange(x, new Map())

  it('深さから親を決める', () => {
    const [a, b, c, d] = project.tracks
    expect([a.parent, b.parent, c.parent, d.parent]).toEqual([undefined, a.id, b.id, undefined])
  })

  it('見つからない音声は無音の仮の音にし、使う長さを持たせる', () => {
    expect(missing).toBe(1)
    const s = project.sources[0]
    expect(s.missing).toBe('audio/a.wav')
    expect(s.duration).toBeGreaterThanOrEqual(2.5)
    expect(s.clip.channels[0].every((v) => v === 0)).toBe(true)
  })

  it('テンポの変化は、同じ位置のマーカーに持たせ、なければマーカーを足す', () => {
    expect(project.tempo).toMatchObject({ bpm: 100, beatsPerBar: 3 })
    expect(project.markers.map((m) => [m.time, m.name, m.tempo?.bpm])).toEqual([
      [4, 'A', 90],
      [8, '', 80],
    ])
  })

  it('音を割り当てると missing が消える', () => {
    const clip2 = { sampleRate: 48000, channels: [new Float32Array(48000 * 3)] }
    const q = assignAudio(project, project.sources[0].id, clip2, 'a.wav')
    expect(q.sources[0]).toMatchObject({ name: 'a.wav', duration: 3 })
    expect(q.sources[0].missing).toBeUndefined()
  })
})

describe('matchAudio', () => {
  const files = [
    { path: 'Old/a.wav', file: 'old' },
    { path: 'Audio/A.WAV', file: 'audio' },
    { path: 'x/b.wav', file: 'b' },
  ]
  it('パスの後ろがより多く一致するものを選び、なければファイル名で探す', () => {
    const win = String.raw`C:\Users\me\song\Audio\a.wav`
    const m = matchAudio([win, 'b.wav', 'none.wav'], files)
    expect([...m]).toEqual([
      [win, 'audio'],
      ['b.wav', 'b'],
    ])
  })
})
