// edits/tracks.ts のテスト
import { describe, expect, it } from 'vitest'
import { fillBlock, newProject, type Block, type MidiBlock, type Project, type Source, type Track } from '../../project'
import { addSubtrack, addTrackAfter, duplicateTrack, indentTrack, insertTrack, outdentTrack, patchTrack, patchTracks, placeSource, removeTrack, reorderTrack } from './tracks'

const track = (id: string, patch: Partial<Track> = {}): Track => ({ id, name: id, volume: 0, pan: 0, mute: false, solo: false, ...patch })
const source = (id: string): Source => ({ id, name: id, clip: { sampleRate: 100, channels: [new Float32Array(100)] }, duration: 1 })
const block = (id: string, tr: string, patch: Partial<Block> = {}): Block => fillBlock({ id, track: tr, source: 's', start: 0, offset: 0, length: 1, ...patch })
const project = (tracks: Track[], patch: Partial<Project> = {}): Project => ({ ...newProject(), tracks, sources: [source('s')], ...patch })
const ids = (p: Project) => p.tracks.map((t) => t.id)

describe('addTrackAfter と addSubtrack', () => {
  it('after が無ければ一番下、あれば子孫の後ろに足す', () => {
    const p = project([track('a'), track('b', { parent: 'a' }), track('c')])
    expect(ids(addTrackAfter(p, track('x')))).toEqual(['a', 'b', 'c', 'x'])
    expect(ids(addTrackAfter(p, track('x'), 'a'))).toEqual(['a', 'b', 'x', 'c'])
    expect(addTrackAfter(p, track('x')).tracks[3].name).toBe('Track 4')
  })

  it('サブトラックは親の子孫の一番後ろに入り、閉じた親を開く', () => {
    const p = project([track('a', { collapsed: true }), track('b', { parent: 'a' }), track('c')])
    const q = addSubtrack(p, track('x'), 'a')
    expect(ids(q)).toEqual(['a', 'b', 'x', 'c'])
    expect(q.tracks[2].parent).toBe('a')
    expect(q.tracks[0].collapsed).toBe(false)
    expect(addSubtrack(p, track('x'), 'none')).toBe(p)
  })
})

describe('duplicateTrack', () => {
  it('ブロックと MIDI ブロックごと写し、すぐ下に置く（録音の待機は外す）', () => {
    const m: MidiBlock = { id: 'm', track: 'a', start: 0, length: 1, unit: 'beat', notes: [], mute: false }
    const p = project([track('a', { armed: true }), track('b')], { blocks: [block('x', 'a')], midi: [m] })
    const q = duplicateTrack(p, 'a')
    expect(q.tracks).toHaveLength(3)
    expect(q.tracks[1].name).toBe('a (2)')
    expect(q.tracks[1].armed).toBe(false)
    expect(q.blocks.filter((b) => b.track === q.tracks[1].id)).toHaveLength(1)
    expect(q.midi?.filter((b) => b.track === q.tracks[1].id)).toHaveLength(1)
    expect(q.blocks.map((b) => b.id)).not.toContain(q.blocks[1].track)
    expect(duplicateTrack(p, 'none')).toBe(p)
  })
})

describe('insertTrack', () => {
  it('元の音が無いブロックは置かず、新しい id を付ける', () => {
    const p = project([track('a'), track('b')])
    const q = insertTrack(p, track('n'), [block('x', 'old'), block('y', 'old', { source: 'gone' })], 'a')
    expect(ids(q)).toEqual(['a', 'n', 'b'])
    expect(q.blocks).toHaveLength(1)
    expect(q.blocks[0].track).toBe('n')
    expect(q.blocks[0].id).not.toBe('x')
  })
})

describe('removeTrack', () => {
  it('子は一つ上の階層に上がり、使われなくなった音は消える', () => {
    const p = project([track('a'), track('b', { parent: 'a' }), track('c', { parent: 'b' })], { sources: [source('s'), source('t')], blocks: [block('x', 'b', { source: 's' }), block('y', 'c', { source: 't' })] })
    const q = removeTrack(p, 'b')
    expect(ids(q)).toEqual(['a', 'c'])
    expect(q.tracks[1].parent).toBe('a')
    expect(q.blocks.map((b) => b.id)).toEqual(['y'])
    expect(q.sources.map((s) => s.id)).toEqual(['t'])
  })

  it('フリーズや音源が使う音は残す', () => {
    const p = project([track('a', { frozen: { source: 's' } as never }), track('b')], { blocks: [block('x', 'b')] })
    expect(removeTrack(p, 'b').sources.map((s) => s.id)).toEqual(['s'])
  })
})

describe('indentTrack と outdentTrack', () => {
  it('上の同じ階層のトラックの中に入り、外へ出ると親の子孫の後ろへ動く', () => {
    const p = project([track('a'), track('b'), track('c', { parent: 'a' })])
    const inside = indentTrack(p, 'b')
    expect(inside.tracks[1].parent).toBe('a')
    expect(indentTrack(p, 'a')).toBe(p)
    const out = outdentTrack(project([track('a'), track('b', { parent: 'a' }), track('c', { parent: 'a' })]), 'b')
    expect(ids(out)).toEqual(['a', 'c', 'b'])
    expect(out.tracks[2].parent).toBeUndefined()
    expect(outdentTrack(p, 'a')).toBe(p)
  })
})

describe('reorderTrack', () => {
  it('子孫ごと動かし、同じ場所なら何もしない', () => {
    const p = project([track('a'), track('b', { parent: 'a' }), track('c'), track('d')])
    // to は、動かすトラックを抜いた並び（c、d）の中の番号
    expect(ids(reorderTrack(p, 'a', 1))).toEqual(['c', 'a', 'b', 'd'])
    expect(ids(reorderTrack(p, 'a', 2))).toEqual(['c', 'd', 'a', 'b'])
    expect(reorderTrack(p, 'c', 2)).toBe(p)
    expect(ids(reorderTrack(p, 'd', 0))).toEqual(['d', 'a', 'b', 'c'])
    expect(ids(reorderTrack(p, 'd', 99))).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('patchTrack と patchTracks', () => {
  it('指定したトラックだけを変える', () => {
    const p = project([track('a'), track('b')])
    expect(patchTrack(p, 'a', { volume: -3 }).tracks[0].volume).toBe(-3)
    const q = patchTracks(p, { b: { mute: true } })
    expect(q.tracks[0]).toBe(p.tracks[0])
    expect(q.tracks[1].mute).toBe(true)
  })
})

describe('placeSource', () => {
  const defaults = { algorithm: 'sola3' as const, preserveFormant: true }

  it('指定のトラックがあればそこへ置く', () => {
    const p = project([track('a'), track('b')])
    const q = placeSource(p, source('n'), 'n', 'b', 2, defaults, 0.01)
    expect(q.blocks[0].track).toBe('b')
    expect(q.blocks[0].start).toBe(2)
    expect(q.sources.map((s) => s.id)).toContain('n')
  })

  it('指定が無ければ、空のトラックを使って名前をファイル名にする', () => {
    const p = project([track('a'), track('b')], { blocks: [block('x', 'a')] })
    const q = placeSource(p, source('n'), 'voice', undefined, 0, defaults, 0.01)
    expect(q.tracks).toHaveLength(2)
    expect(q.tracks[1].name).toBe('voice')
    expect(q.blocks[1].track).toBe('b')
  })

  it('空のトラックが無ければ、トラックを足す', () => {
    const p = project([track('a')], { blocks: [block('x', 'a')] })
    const q = placeSource(p, source('n'), 'voice', undefined, 0, defaults, 0.01)
    expect(q.tracks).toHaveLength(2)
    expect(q.tracks[1].name).toBe('voice')
  })
})
