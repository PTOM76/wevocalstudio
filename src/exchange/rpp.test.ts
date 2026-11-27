// rpp.ts のテスト（フォルダーの印、クリップの項目、文字列の囲み）
import { describe, expect, it } from 'vitest'
import type { XClip, XMidi, XProject, XTrack } from './exchange'
import { writeRpp } from './rpp'
import { beatMap } from '../beats'
import { DEFAULT_TEMPO, type MidiBlock } from '../project'
import { midiEvents, PPQ } from './exchange'

const clip = (o: Partial<XClip> = {}): XClip => ({ name: 'a', start: 1, length: 2, file: 'audio/a.wav', offset: 0.5, gain: -6, fadeIn: 0.01, fadeOut: 0.02, rate: 1.5, pitch: 2, mute: false, ...o })
const track = (name: string, depth: number, clips: XClip[] = [], midi: XMidi[] = []): XTrack => ({ name, volume: 0, pan: 0, mute: false, solo: false, invert: false, depth, clips, midi })
const project = (tracks: XTrack[]): XProject => ({ bpm: 128, beatsPerBar: 3, markers: [{ time: 4, name: 'サビ' }], master: { volume: 0, pan: 0, mute: false }, tracks, files: new Map() })

describe('writeRpp', () => {
  it('親と子をフォルダーにする', () => {
    const text = writeRpp(project([track('親', 0), track('子1', 1), track('孫', 2), track('別', 0)]))
    expect(text.match(/ISBUS .*/g)).toEqual(['ISBUS 1 1', 'ISBUS 1 1', 'ISBUS 2 -2', 'ISBUS 0 0'])
  })

  it('テンポ、マーカー、クリップの項目', () => {
    const text = writeRpp(project([track('歌', 0, [clip()])]))
    expect(text).toContain('TEMPO 128 3 4')
    expect(text).toContain('MARKER 1 4 "サビ" 0')
    expect(text).toContain('POSITION 1')
    expect(text).toContain('SOFFS 0.5')
    expect(text).toContain('PLAYRATE 1.5 1 2 -1 0 0.0025')
    expect(text).toContain(`VOLPAN 1 0 ${Math.round(10 ** (-6 / 20) * 1e10) / 1e10} -1`)
    expect(text).toContain('FILE "audio/a.wav"')
    // 開きと閉じの数がそろう
    expect(text.match(/^\s*</gm)!.length).toBe(text.match(/^\s*>$/gm)!.length)
  })

  it('" を含む名前は別の記号で囲む', () => {
    const text = writeRpp(project([track('a "b"', 0)]))
    expect(text).toContain(`NAME 'a "b"'`)
  })
})

describe('MIDI', () => {
  const map = beatMap(DEFAULT_TEMPO, [])
  const block = (o: Partial<MidiBlock> = {}): MidiBlock => ({ id: 'm', track: 't', start: 0, length: 2, mute: false, unit: 'beat', notes: [{ id: 'n', t: 0, dur: 1, pitch: 60, vel: 1 }], ...o })

  it('音符を tick のイベントにし、ループを展開する', () => {
    // 120 BPM で 2 秒 = 4 拍。1 拍のループで 4 回
    const m = midiEvents(block({ loop: 1 }), map)
    expect(m.ticks).toBe(4 * PPQ)
    expect(m.events.filter((e) => e.bytes[0] === 0x90).map((e) => e.tick)).toEqual([0, 960, 1920, 2880])
    // 同じ tick では離すほうが先
    expect(m.events[1].bytes[0]).toBe(0x80)
    expect(m.events[2].bytes[0]).toBe(0x90)
  })

  it('ミュートした音符は除き、ピッチベンドは 14 ビットにする', () => {
    const m = midiEvents(block({ notes: [{ id: 'n', t: 0, dur: 1, pitch: 60, vel: 1, mute: true }], curves: [{ kind: 'bend', points: [{ t: 0, v: 0 }] }] }), map)
    expect(m.events).toEqual([{ tick: 0, bytes: [0xe0, 0x00, 0x40] }])
  })

  it('RPP に MIDI のアイテムを書く', () => {
    const text = writeRpp(project([track('ピアノ', 0, [], [midiEvents(block(), map)])]))
    expect(text).toContain('HASDATA 1 960 QN')
    expect(text).toContain('E 0 90 3c 7f')
    expect(text).toContain('E 960 80 3c 00')
    expect(text).toContain('E 2880 b0 7b 00')
  })
})
