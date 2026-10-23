// gesture.ts のテスト
import { describe, expect, it, vi } from 'vitest'
import type { Note } from '../project'
import { dragDelta, movedNotes, notesInBox, rollGestureSlot, sizedNotes, type RollGesture } from './gesture'
import { KEYS, type View } from './view'

const note = (id: string, t: number, dur: number, pitch = 60): Note => ({ id, t, dur, pitch, vel: 100 }) as Note
// 1 拍 = 20px、1 行 = 10px、C4 (60) が一番上の行になる 12 行の画面
const view: View = { left: 0, ppb: 20, low: 49, row: 10, fold: null, vel: 0, w: 600, h: 120 } as View

describe('movedNotes', () => {
  const start = [note('a', 1, 1, 60), note('b', 3, 1, 64), note('c', 0, 1, 40)]

  it('選んだものだけを、同じだけ動かす', () => {
    const out = movedNotes(start, start, ['a', 'b'], 1, 2, 8)
    expect(out.map((n) => [n.t, n.pitch])).toEqual([[2, 62], [4, 66], [0, 40]])
  })

  it('選んだものが全部収まる範囲までしか動かさない（時間は 0 とブロックの終わり、高さは 0 と 127）', () => {
    expect(movedNotes(start, start, ['a', 'b'], -5, 0, 8).map((n) => n.t)).toEqual([0, 2, 0])
    expect(movedNotes(start, start, ['a', 'b'], 9, 0, 8).map((n) => n.t)).toEqual([5, 7, 0])
    expect(movedNotes(start, start, ['a', 'b'], 0, 99, 8).map((n) => n.pitch)).toEqual([123, 127, 40])
    expect(movedNotes(start, start, ['c'], 0, -99, 8)[2].pitch).toBe(0)
  })

  it('選んでいなければ、今のままを返す', () => {
    expect(movedNotes(start, start, [], 1, 1, 8)).toBe(start)
  })
})

describe('sizedNotes', () => {
  const start = [note('a', 1, 2), note('b', 6, 1)]

  it('選んだものの長さを変える。最短は step、ブロックの終わりまで', () => {
    expect(sizedNotes(start, start, ['a'], 1, 8, 0.25)[0].dur).toBe(3)
    expect(sizedNotes(start, start, ['a'], -9, 8, 0.25)[0].dur).toBe(0.25)
    expect(sizedNotes(start, start, ['b'], 9, 8, 0.25)[1].dur).toBe(2)
  })

  it('選んでいないものは変えない', () => {
    const out = sizedNotes(start, start, ['a'], 1, 8, 0.25)
    expect(out[1]).toEqual(start[1])
  })
})

describe('notesInBox', () => {
  const notes = [note('in', 1, 1, 60), note('out', 20, 1, 60), note('high', 1, 1, 90)]

  it('枠にかかる音符を返す（画面の外の高さは含めない）', () => {
    // 1 拍目の音符は x = KEYS + 20 〜 KEYS + 40
    expect(notesInBox(notes, view, KEYS, 0, KEYS + 100, 200)).toEqual(['in'])
    expect(notesInBox(notes, view, KEYS + 100, 0, KEYS + 200, 200)).toEqual([])
  })

  it('枠はどの向きにドラッグしても同じ', () => {
    expect(notesInBox(notes, view, KEYS + 100, 200, KEYS, 0)).toEqual(['in'])
  })
})

describe('dragDelta', () => {
  it('動かし始めた位置からの差を返し、拍は snap で丸める', () => {
    const d = dragDelta(view, KEYS + 45, 0, 1, 70, (b) => Math.round(b))
    expect(d.dBeat).toBe(1)
    expect(d.dPitch).toBe(60 - 70)
  })
})

describe('rollGestureSlot', () => {
  it('なぞりを別の操作に書き替えると、長押しのタイマーを止める', () => {
    vi.useFakeTimers()
    const fired = vi.fn()
    const slot = rollGestureSlot({ current: null as RollGesture | null })
    const timer = setTimeout(fired, 450) as unknown as number
    slot.current = { kind: 'pan', x: 0, y: 0, cx: 0, cy: 0, left0: 0, low0: 0, t0: 0, moved: false, timer }
    slot.current = { kind: 'key' }
    vi.runAllTimers()
    expect(fired).not.toHaveBeenCalled()
    expect(slot.current).toEqual({ kind: 'key' })
    slot.current = null
    expect(slot.current).toBeNull()
    vi.useRealTimers()
  })
})
