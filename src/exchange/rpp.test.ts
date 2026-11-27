// rpp.ts のテスト（フォルダーの印、クリップの項目、文字列の囲み）
import { describe, expect, it } from 'vitest'
import type { XClip, XProject, XTrack } from './exchange'
import { writeRpp } from './rpp'

const clip = (o: Partial<XClip> = {}): XClip => ({ name: 'a', start: 1, length: 2, file: 'audio/a.wav', offset: 0.5, gain: -6, fadeIn: 0.01, fadeOut: 0.02, rate: 1.5, pitch: 2, mute: false, ...o })
const track = (name: string, depth: number, clips: XClip[] = []): XTrack => ({ name, volume: 0, pan: 0, mute: false, solo: false, invert: false, depth, clips })
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
