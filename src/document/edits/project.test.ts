// edits/project.ts のテスト
import { describe, expect, it } from 'vitest'
import { newProject, type MidiBlock } from '../../project'
import { addMarker, adoptTempoChanges, patchMarker, patchMaster, patchTempo, removeMarker, setEnd, stretchToTempo } from './project'

describe('マーカー', () => {
  it('時刻の順に並べ、同じ位置には足さない', () => {
    let p = addMarker(newProject(), 5)
    p = addMarker(p, 1)
    expect(p.markers.map((m) => m.time)).toEqual([1, 5])
    expect(p.markers.map((m) => m.name)).toEqual(['M2', 'M1'])
    expect(addMarker(p, 1.0005)).toBe(p)
  })

  it('変えて、消せる', () => {
    const p = addMarker(newProject(), 1)
    const id = p.markers[0].id
    expect(patchMarker(p, id, { name: 'Verse' }).markers[0].name).toBe('Verse')
    expect(removeMarker(p, id).markers).toEqual([])
  })
})

describe('setEnd', () => {
  it('決めて、null で自動に戻す', () => {
    const p = setEnd(newProject(), 30)
    expect(p.end).toBe(30)
    expect('end' in setEnd(p, null)).toBe(false)
  })
})

describe('patchTempo', () => {
  it('MIDI ブロックは拍の位置を保つよう、秒を直す', () => {
    const m: MidiBlock = { id: 'm', track: 't', start: 2, length: 4, unit: 'beat', notes: [], mute: false }
    const p = { ...newProject(120), midi: [m] }
    const q = patchTempo(p, { bpm: 60 })
    // 120bpm の 2 秒は 4 拍目。60bpm では 4 秒。長さ 4 秒は 8 拍なので 8 秒
    expect(q.midi![0].start).toBeCloseTo(4)
    expect(q.midi![0].length).toBeCloseTo(8)
    expect(q.tempo.bpm).toBe(60)
  })

  it('MIDI ブロックが無ければテンポだけを変える', () => {
    expect(patchTempo(newProject(120), { bpm: 90 }).tempo.bpm).toBe(90)
  })
})

describe('patchMaster', () => {
  it('マスターを変える', () => {
    expect(patchMaster(newProject(), { volume: -6 }).master.volume).toBe(-6)
  })
})

describe('adoptTempoChanges', () => {
  it('最初の区間を曲の頭のテンポにし、続く区間にテンポのマーカーを置く', () => {
    const p = adoptTempoChanges(addMarker(newProject(), 30), [
      { time: 0, bpm: 100, offset: 0.7 },
      { time: 30, bpm: 140, offset: 30 },
      { time: 60, bpm: 90, offset: 60 },
    ])
    expect(p.tempo.bpm).toBe(100)
    expect(p.tempo.beatOffset).toBeCloseTo(0.1)
    // 同じ位置のマーカーはテンポを持たせるだけ
    expect(p.markers.map((m) => [m.time, m.tempo?.bpm])).toEqual([
      [30, 140],
      [60, 90],
    ])
  })
})

describe('stretchToTempo', () => {
  it('波形ブロックの位置、長さ、速度とマーカーを旧 BPM ÷ 新 BPM 倍にする', () => {
    const base = addMarker(newProject(120), 4)
    const p0 = { ...base, blocks: [{ id: 'b', track: base.tracks[0].id, source: 's', start: 2, length: 4, offset: 1, rate: 1, gain: 0, pitch: 0, algorithm: 'sola3' as const, preserveFormant: true, formant: 0, fadeIn: 0.01, fadeOut: 0.02, mute: false }] }
    const p = stretchToTempo(p0, 60)
    expect(p.tempo.bpm).toBe(60)
    expect(p.blocks[0]).toMatchObject({ start: 4, length: 8, rate: 0.5, offset: 1, fadeIn: 0.02, fadeOut: 0.04 })
    expect(p.markers[0].time).toBe(8)
  })
})
