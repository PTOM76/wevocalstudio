// engine/midiEvents.ts と params.ts の純粋な関数のテスト
import { describe, expect, it } from 'vitest'
import { newProject, type MidiBlock, type Note, type Project } from '../project'
import { controlEvents, noteEvents } from './midiEvents'
import { volumeSteps } from './params'

const note = (id: string, t: number, dur: number, pitch = 60, patch: Partial<Note> = {}): Note => ({ id, t, dur, pitch, vel: 100, ...patch }) as Note
const block = (patch: Partial<MidiBlock> = {}): MidiBlock => ({ id: 'm', track: 'tr', start: 0, length: 4, unit: 'beat', notes: [], mute: false, ...patch })
const project = (blocks: MidiBlock[], patch: Partial<Project> = {}): Project => {
  const p = newProject(120)
  return { ...p, tracks: [{ ...p.tracks[0], id: 'tr' }], midi: blocks, ...patch }
}

describe('noteEvents', () => {
  it('拍を秒にして、zero を足し、時刻の順に並べる', () => {
    // 120bpm: 1 拍 = 0.5 秒
    const p = project([block({ start: 1, notes: [note('b', 2, 1, 64), note('a', 0, 1, 60)] })])
    const ev = noteEvents(p, 'tr', -Infinity, Infinity, 10)
    expect(ev.map((e) => e.pitch)).toEqual([60, 64])
    expect(ev[0].time).toBeCloseTo(10 + 1)
    expect(ev[0].dur).toBeCloseTo(0.5)
    expect(ev[1].time).toBeCloseTo(10 + 2)
  })

  it('範囲 [from, to) に始まる音符だけを返す', () => {
    const p = project([block({ notes: [note('a', 0, 1), note('b', 2, 1), note('c', 4, 1)] })])
    expect(noteEvents(p, 'tr', 0.5, 2, 0).map((e) => e.pitch)).toHaveLength(1)
    expect(noteEvents(p, 'tr', 0, 1, 0)).toHaveLength(1)
    expect(noteEvents(p, 'tr', 0, 0, 0)).toHaveLength(0)
  })

  it('ミュートしたブロック、音符、別のトラック、鳴らないトラックは含めない', () => {
    const notes = [note('a', 0, 1), note('b', 1, 1, 62, { mute: true })]
    expect(noteEvents(project([block({ notes })]), 'tr', -Infinity, Infinity, 0)).toHaveLength(1)
    expect(noteEvents(project([block({ notes, mute: true })]), 'tr', -Infinity, Infinity, 0)).toHaveLength(0)
    expect(noteEvents(project([block({ notes, track: 'other' })]), 'tr', -Infinity, Infinity, 0)).toHaveLength(0)
    const p = project([block({ notes })])
    const muted = { ...p, tracks: [{ ...p.tracks[0], mute: true }] }
    expect(noteEvents(muted, 'tr', -Infinity, Infinity, 0)).toHaveLength(0)
  })
})

describe('controlEvents', () => {
  it('曲線が無ければ空、あれば zero を足して並べる', () => {
    expect(controlEvents(project([block()]), 'tr', -Infinity, Infinity, 0)).toEqual([])
    const curves = [{ kind: 'cc', cc: 1, points: [{ t: 0, v: 0 }, { t: 2, v: 100 }] }] as never
    const ev = controlEvents(project([block({ curves })]), 'tr', -Infinity, Infinity, 5)
    expect(ev.length).toBeGreaterThan(0)
    expect(ev.every((e) => e.cc === 1 && e.time >= 5)).toBe(true)
    expect(ev.map((e) => e.time)).toEqual([...ev.map((e) => e.time)].sort((a, b) => a - b))
  })
})

describe('volumeSteps', () => {
  it('直線や形状のない区間は点をそのまま返す', () => {
    const env = [{ t: 0, db: 0 }, { t: 1, db: -6 }]
    expect(volumeSteps(env)).toEqual(env)
  })

  it('矩形は、次の点の直前まで同じ値で保つ', () => {
    const out = volumeSteps([{ t: 0, db: 0, shape: 'square' }, { t: 1, db: -6 }])
    expect(out).toHaveLength(3)
    expect(out[1].db).toBe(0)
    expect(out[1].t).toBeCloseTo(0.999)
  })

  it('曲線の区間は 15 点に展開する', () => {
    const out = volumeSteps([{ t: 0, db: 0, shape: 'fastStart' }, { t: 1, db: -12 }])
    expect(out).toHaveLength(2 + 15)
    expect(out.at(-1)).toEqual({ t: 1, db: -12 })
  })
})
