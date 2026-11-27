// REAPER のピッチの処理方式とテイクのエンベロープのテスト（値は架空のもの）
import { describe, expect, it } from 'vitest'
import type { Block } from '../project'
import { blockEnvelopes, type XProject } from './exchange'
import { clipExtras } from './fromExchange'
import { DEFAULT_REAPER_PITCH_MAP, REAPER_PRO, REAPER_SOLOIST, reaperModeFor, reaperPitchKind, simplify } from './reaperPitch'
import { writeRpp } from './rpp'
import { readRpp } from './rppRead'

const clip = { name: 'a', start: 0, length: 1, file: 'a.wav', offset: 2, gain: 0, fadeIn: 0, fadeOut: 0, rate: 1, pitch: 1, mute: false }
const project = (c: typeof clip & Record<string, unknown>, def?: number): string => {
  const x: XProject = { bpm: 120, beatsPerBar: 4, markers: [], tempos: [], master: { volume: 0, pan: 0, mute: false }, files: new Map(), tracks: [{ name: 't', volume: 0, pan: 0, mute: false, solo: false, invert: false, depth: 0, clips: [c], midi: [] }] }
  const text = writeRpp(x)
  return def === undefined ? text : text.replace('  TEMPO', `  DEFPITCHMODE ${def} 0\n  TEMPO`)
}

describe('処理方式', () => {
  it('番号の上位 16 ビットで種類を決める', () => {
    expect([reaperPitchKind(9 << 16), reaperPitchKind((9 << 16) | 5), reaperPitchKind(11 << 16), reaperPitchKind(10 << 16), reaperPitchKind(13 << 16)]).toEqual(['pro', 'pro', 'soloist', 'efficient', 'other'])
  })

  it('書き出しは声向けの方式を Soloist、ほかを Pro にし、読むと対応表の方式になる。-1 はプロジェクトの既定', () => {
    expect([reaperModeFor('sola3'), reaperModeFor('pv2')]).toEqual([REAPER_SOLOIST, REAPER_PRO])
    const soloist = readRpp(project({ ...clip, pitchMode: REAPER_SOLOIST })).project.tracks[0].clips[0]
    expect(clipExtras(soloist, 1, DEFAULT_REAPER_PITCH_MAP)).toMatchObject({ algorithm: 'sola3', preserveFormant: true })
    const byDefault = readRpp(project(clip, REAPER_PRO)).project.tracks[0].clips[0]
    expect(byDefault.pitchMode).toBe(REAPER_PRO)
    expect(clipExtras(byDefault, 1, DEFAULT_REAPER_PITCH_MAP)).toMatchObject({ algorithm: 'pv2', preserveFormant: false })
  })
})

describe('テイクのエンベロープ', () => {
  it('ピッチ（半音）と音量（倍率で書き、dB で読む）が往復する。点の形も', () => {
    const pitchEnv = [{ t: 0, v: 2, shape: 'fastStart' as const }, { t: 0.5, v: -1 }]
    const volEnv = [{ t: 0, v: 0 }, { t: 0.25, v: -6, shape: 'bezier' as const, tension: 0.5 }]
    const c = readRpp(project({ ...clip, pitchEnv, volEnv })).project.tracks[0].clips[0]
    expect(c.pitchEnv).toEqual(pitchEnv)
    expect(c.volEnv!.map((p) => ({ ...p, v: Math.round(p.v * 100) / 100 }))).toEqual(volEnv)
  })

  it('読んだピッチのエンベロープは元の音の時刻へ（速度とアイテムの頭の位置を足す）', () => {
    const extras = clipExtras({ ...clip, rate: 2, pitchEnv: [{ t: 0.5, v: 3 }] }, 2, DEFAULT_REAPER_PITCH_MAP)
    expect(extras.pitchEnvelope).toEqual([{ s: 3, st: 3 }])
  })

  it('書き出しでは、ピッチのエンベロープをアイテムの時刻にし、ピッチカーブは間引いた点にする', () => {
    const b = { offset: 2, rate: 2, length: 1, pitchEnvelope: [{ s: 3, st: 1 }] } as unknown as Block
    expect(blockEnvelopes(b).pitchEnv).toEqual([{ t: 0.5, v: 1 }])
    // 0 から 2 半音へ直線で上がるカーブは、両端の 2 点だけになる
    const st = Array.from({ length: 201 }, (_, i) => (i / 200) * 2)
    const curved = { offset: 0, rate: 1, length: 2, curve: { from: 0, st } } as unknown as Block
    expect(blockEnvelopes(curved).pitchEnv!.length).toBe(2)
  })

  it('simplify は許す差を超える点を残す', () => {
    const pts = [{ t: 0, v: 0 }, { t: 1, v: 1 }, { t: 2, v: 0 }]
    expect(simplify(pts, 0.1)).toHaveLength(3)
    expect(simplify([{ t: 0, v: 0 }, { t: 1, v: 1.01 }, { t: 2, v: 2 }], 0.1)).toHaveLength(2)
  })
})
