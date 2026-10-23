// timeline/dragMath.ts のテスト
import { describe, expect, it } from 'vitest'
import type { Drag } from '../blockDrag'
import { ENVELOPES } from '../envelopes'
import { fillBlock, newProject, type Block, type MidiBlock, type Project, type Track } from '../project'
import { blockDragPatches, marqueeIds, midiDragPatch, movedAutoPoints, movedEnvPoints, rangeSelectIds } from './dragMath'

const track = (id: string): Track => ({ id, name: id, volume: 0, pan: 0, mute: false, solo: false })
const block = (id: string, tr: string, start: number, length = 2, patch: Partial<Block> = {}): Block => fillBlock({ id, track: tr, source: 's', start, offset: 0, length, ...patch })
const project = (blocks: Block[]): Project => ({ ...newProject(), tracks: [track('t1'), track('t2'), track('t3')], blocks })
const snapping = { mode: 'beats', division: 4, tempo: { bpm: 120, beatsPerBar: 4, beatOffset: 0 }, markers: [], pps: 100 } as never
const opts = { altKey: false, shiftKey: false, snap: false, cursor: 0, snapping }

describe('blockDragPatches', () => {
  const a = block('a', 't1', 1)
  const b = block('b', 't2', 4)

  it('1 つだけ動かす: 位置が変わる（吸い付けなければ動きのまま）', () => {
    const d = { kind: 'move', block: a, others: [], x: 0, y: 0, trackIndex: 0, merge: 'd' } as Drag
    const out = blockDragPatches(project([a, b]), d, 0.5, 0, opts)
    expect(Object.keys(out)).toEqual(['a'])
    expect(out.a.start).toBeCloseTo(1.5)
  })

  it('まとめて動かす: 一番前のものが 0 より前に出ない所で止め、トラックの外には出ない', () => {
    const d = { kind: 'move', block: a, others: [b], x: 0, y: 0, trackIndex: 0, merge: 'd' } as Drag
    const p = project([a, b])
    expect(blockDragPatches(p, d, -5, 0, opts).a.start).toBe(0)
    expect(blockDragPatches(p, d, -5, 0, opts).b.start).toBeCloseTo(3)
    // a は 1 行目、b は 2 行目。3 行しかないので、下へ 5 行動かしても b は 3 行目まで
    const down = blockDragPatches(p, d, 0, 5, opts)
    expect([down.a.track, down.b.track]).toEqual(['t2', 't3'])
  })

  it('端をドラッグすると、まとめて長さを変える（選んだ全部の patch）', () => {
    const d = { kind: 'right', block: a, others: [b], x: 0, y: 0, trackIndex: 0, merge: 'd' } as Drag
    const out = blockDragPatches(project([a, b]), d, 0.5, 0, opts)
    expect(Object.keys(out).sort()).toEqual(['a', 'b'])
  })
})

describe('midiDragPatch', () => {
  const orig: MidiBlock = { id: 'm', track: 't1', start: 2, length: 4, unit: 'beat', notes: [], mute: false }
  const p = project([])
  const grid = (x: number) => x / 100

  it('動かす: 掴んだ位置を保ち、0 より前には出ず、縦のトラックへ移る', () => {
    expect(midiDragPatch(p, { kind: 'move', grabPx: 50, orig, alt: false }, orig, 350, 't2', grid)).toEqual({ start: 3, track: 't2' })
    expect(midiDragPatch(p, { kind: 'move', grabPx: 500, orig, alt: false }, orig, 100, undefined, grid)).toEqual({ start: 0 })
  })

  it('右端: 長さを変える。最短は 0.05 秒。Alt でループにして伸ばす', () => {
    const md = { kind: 'right' as const, grabPx: 0, orig, alt: false }
    expect(midiDragPatch(p, md, orig, 600, undefined, grid)).toEqual({ length: 4 })
    expect(midiDragPatch(p, md, orig, 100, undefined, grid).length).toBe(0.05)
    expect(midiDragPatch(p, { ...md, alt: true }, orig, 600, undefined, grid)).toHaveProperty('loop')
  })
})

describe('movedAutoPoints', () => {
  const lane = { points: [{ t: 1, v: 0 }, { t: 2, v: 0 }, { t: 3, v: 0 }], def: { min: 0, max: 1 }, top: 0, h: 100 } as never

  it('前後の点は越えない', () => {
    expect(movedAutoPoints(lane, 1, 50, 9)?.[1].t).toBe(3)
    expect(movedAutoPoints(lane, 1, 50, 0)?.[1].t).toBe(1)
    expect(movedAutoPoints(lane, 1, 50, 2.4)?.[1].t).toBe(2.4)
  })

  it('点がなければ null', () => {
    expect(movedAutoPoints(lane, 7, 50, 2)).toBeNull()
  })
})

describe('movedEnvPoints', () => {
  const b = block('a', 't1', 0, 4, { envelope: [{ t: 0, db: 0 }, { t: 2, db: -6 }, { t: 4, db: 0 }] })
  const g = { x: 0, top: 0, h: 100 }

  it('前後の点は越えず、ブロックの終わりまで', () => {
    expect(movedEnvPoints(ENVELOPES.volume, b, 1, 900, 50, g, 100, 24)?.[1].t).toBe(4)
    expect(movedEnvPoints(ENVELOPES.volume, b, 1, -500, 50, g, 100, 24)?.[1].t).toBe(0)
    expect(movedEnvPoints(ENVELOPES.volume, b, 1, 150, 50, g, 100, 24)?.[1].t).toBeCloseTo(1.5)
  })

  it('点がなければ null', () => {
    expect(movedEnvPoints(ENVELOPES.volume, b, 9, 0, 0, g, 100, 24)).toBeNull()
  })
})

describe('marqueeIds と rangeSelectIds', () => {
  const a = block('a', 't1', 0, 2)
  const b = block('b', 't2', 3, 2)
  const c = block('c', 't3', 6, 2)
  const p = project([a, b, c])

  it('枠にかかる波形ブロックを返す（時間とトラックの両方）', () => {
    const toTime = (x: number) => x / 100
    const slotAt = (y: number) => Math.floor(y / 100)
    expect(marqueeIds(p, 0, 0, 250, 150, toTime, slotAt)).toEqual(['a'])
    expect(marqueeIds(p, 0, 0, 500, 150, toTime, slotAt)).toEqual(['a', 'b'])
    expect(marqueeIds(p, 500, 150, 0, 0, toTime, slotAt)).toEqual(['a', 'b'])
  })

  it('Shift: 起点から押したものまでの、トラックと時間の範囲', () => {
    expect(rangeSelectIds(p, a, b)).toEqual(['a', 'b'])
    expect(rangeSelectIds(p, c, a)).toEqual(['a', 'b', 'c'])
    expect(rangeSelectIds(p, b, b)).toEqual(['b'])
  })
})
