// dawproject.ts のテスト（XML の形、入れ子のトラック、伸縮の対応点、音符）
import { describe, expect, it } from 'vitest'
import { notesOf, writeDawproject } from './dawproject'
import { PPQ, type XClip, type XMidi, type XProject, type XTrack } from './exchange'

const clip: XClip = { name: 'a&b', start: 1, length: 2, file: 'audio/a.wav', offset: 0.5, gain: 0, fadeIn: 0.01, fadeOut: 0.02, rate: 1.5, pitch: 0, mute: false }
const midi: XMidi = { name: 'm', start: 0, length: 2, mute: false, ticks: 4 * PPQ, events: [{ tick: 0, bytes: [0x90, 60, 127] }, { tick: PPQ, bytes: [0x80, 60, 0] }, { tick: 2 * PPQ, bytes: [0x90, 62, 64] }] }
const track = (name: string, depth: number, o: Partial<XTrack> = {}): XTrack => ({ name, volume: 0, pan: 0, mute: false, solo: false, invert: false, depth, clips: [], midi: [], ...o })
const project = (tracks: XTrack[]): XProject => ({ bpm: 120, beatsPerBar: 4, markers: [{ time: 3, name: 'A' }], tempos: [{ time: 8, bpm: 90, beatsPerBar: 4 }], master: { volume: 0, pan: 0, mute: false }, tracks, files: new Map() })

/** 開きと閉じのタグがそろうか（自分で閉じるタグは数えない） */
function balanced(xml: string) {
  const stack: string[] = []
  for (const m of xml.matchAll(/<(\/?)([A-Za-z]+)[^>]*?(\/?)>/g)) {
    if (m[3]) continue
    if (!m[1]) stack.push(m[2])
    else if (stack.pop() !== m[2]) return false
  }
  return stack.length === 0
}

describe('writeDawproject', () => {
  const xml = writeDawproject(project([track('親', 0), track('子', 1, { clips: [clip] }), track('別', 0, { midi: [midi] })]), { name: 'Test', version: '1' })

  it('タグがそろい、名前を逃がす', () => {
    expect(balanced(xml)).toBe(true)
    expect(xml).toContain('name="a&amp;b"')
  })

  it('子のトラックは親の中に入れ、親はサブミックス', () => {
    const parent = xml.indexOf('name="親"')
    const kid = xml.indexOf('name="子"')
    const other = xml.indexOf('name="別"')
    expect(parent).toBeLessThan(kid)
    expect(xml.slice(parent, kid)).toContain('role="submix"')
    expect(xml.slice(kid, other)).toContain('</Track>')
    expect(xml).toContain('contentType="tracks"')
  })

  it('元の音の開始と速度を伸縮の対応点にする', () => {
    expect(xml).toContain('<Warp time="0" contentTime="0.5"/>')
    expect(xml).toContain('<Warp time="2" contentTime="3.5"/>')
  })

  it('テンポの変化とマーカー', () => {
    expect(xml).toContain('<RealPoint time="8" value="90" interpolation="hold"/>')
    expect(xml).toContain('<Marker time="3" name="A"')
  })
})

describe('notesOf', () => {
  it('イベントから音符を組み立て、押したままの音は終わりで切る', () => {
    expect(notesOf(midi)).toEqual([
      { time: 0, duration: 1, key: 60, vel: 1 },
      { time: 2, duration: 2, key: 62, vel: 64 / 127 },
    ])
  })
})
