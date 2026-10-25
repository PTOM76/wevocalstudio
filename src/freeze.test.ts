// freeze.ts のテスト（FX まで含めてフリーズしたトラックの FX の列）
import { describe, expect, it, vi } from 'vitest'
import { keepFrozen } from './freeze'
import { frozenFxCount, liveSlots, newProject, newTrack, type Project, type Track } from './project'

// 描画は使わない（読み込むと画面の部品まで読み込まれる）
vi.mock('./engine', () => ({ renderMix: vi.fn() }))

const slot = (plugin: string) => ({ plugin, version: '1', on: true, values: {} })

const withTrack = (t: Track): Project => ({ ...newProject(), tracks: [t] })

describe('FX まで含めたフリーズ', () => {
  const a = slot('a')
  const b = slot('b')
  const track: Track = { ...newTrack(1), fx: [a, b], frozen: { source: 's', start: 0, fx: true, fxCount: 2 } }

  it('音に含めた FX は動かさず、後から足した FX だけ動かす', () => {
    const c = slot('c')
    expect(liveSlots(track)).toEqual([])
    expect(liveSlots({ ...track, fx: [a, b, c] })).toEqual([c])
  })

  it('後ろに足した FX は通す', () => {
    const c = slot('c')
    const prev = withTrack(track)
    const next = withTrack({ ...track, fx: [a, b, c] })
    expect(keepFrozen(prev, next).tracks[0].fx).toEqual([a, b, c])
  })

  it('音に含めた FX の変更と削除は戻す', () => {
    const prev = withTrack(track)
    expect(keepFrozen(prev, withTrack({ ...track, fx: [{ ...a, on: false }, b] })).tracks[0].fx).toEqual([a, b])
    expect(keepFrozen(prev, withTrack({ ...track, fx: [b] })).tracks[0].fx).toEqual([a, b])
  })

  it('個数を記録していない古いものは、足したときに今の個数を記録する', () => {
    const old: Track = { ...track, frozen: { source: 's', start: 0, fx: true } }
    const c = slot('c')
    const out = keepFrozen(withTrack(old), withTrack({ ...old, fx: [a, b, c] })).tracks[0]
    expect(out.fx).toEqual([a, b, c])
    expect(frozenFxCount(out)).toBe(2)
  })
})
