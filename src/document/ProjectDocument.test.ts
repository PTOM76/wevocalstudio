// ProjectDocument.ts のテスト
import { describe, expect, it } from 'vitest'
import { fillBlock, newProject, type Block, type Project } from '../project'
import { ProjectDocument } from './ProjectDocument'

const block = (id: string, patch: Partial<Block> = {}): Block => fillBlock({ id, track: 't', source: 's', start: 0, offset: 0, length: 1, ...patch })
const make = (patch: Partial<Project> = {}, guard?: (prev: Project, next: Project) => Project) => new ProjectDocument({ ...newProject(), blocks: [block('a'), block('b')], ...patch }, { limit: () => 100, guard })
const labels = (d: ProjectDocument) => [...d.store.get().past, d.store.get().present].map((s) => s.label)

describe('change', () => {
  it('変えると名前が付き、元に戻せる', () => {
    const d = make()
    d.change((p) => ({ ...p, blocks: p.blocks.filter((b) => b.id !== 'a') }))
    expect(d.project.blocks.map((b) => b.id)).toEqual(['b'])
    expect(labels(d)).toEqual(['history.new', 'history.delete'])
    d.undo()
    expect(d.project.blocks).toHaveLength(2)
    d.redo()
    expect(d.project.blocks).toHaveLength(1)
  })

  it('同じプロジェクトを返したら何もしない', () => {
    const d = make()
    d.change((p) => p)
    expect(d.store.get().past).toEqual([])
  })

  it('merge が続くあいだは 1 段で、名前は最初のまま', () => {
    const d = make()
    d.change((p) => ({ ...p, blocks: p.blocks.map((b) => ({ ...b, start: 1 })) }), 'move')
    d.change((p) => ({ ...p, blocks: p.blocks.map((b) => ({ ...b, pitch: 2 })) }), 'move')
    expect(d.store.get().past).toHaveLength(1)
    expect(labels(d)).toEqual(['history.new', 'history.move'])
    d.endMerge()
    d.change((p) => ({ ...p, blocks: p.blocks.map((b) => ({ ...b, start: 3 })) }), 'move')
    expect(d.store.get().past).toHaveLength(2)
  })

  it('消えたブロックを選択から外す', () => {
    const d = make()
    d.select(['a', 'b'])
    d.change((p) => ({ ...p, blocks: p.blocks.filter((b) => b.id !== 'a') }))
    expect(d.selected).toEqual(['b'])
  })

  it('guard で、通す前に変更を直せる', () => {
    const d = make({}, (prev, next) => ({ ...next, blocks: prev.blocks }))
    d.change((p) => ({ ...p, blocks: [] }))
    expect(d.project.blocks).toHaveLength(2)
  })
})

describe('select', () => {
  it('選択も元に戻せて、同じ選択は積まない', () => {
    const d = make()
    d.select(['a'])
    d.select(['a'])
    expect(d.store.get().past).toHaveLength(1)
    expect(labels(d)).toEqual(['history.new', 'history.select'])
    d.undo()
    expect(d.selected).toEqual([])
  })

  it('merge が続く選択（枠のドラッグ）は 1 段にまとめる', () => {
    const d = make()
    d.select(['a'], 'box')
    d.select(['a', 'b'], 'box')
    expect(d.store.get().past).toHaveLength(1)
    expect(d.selected).toEqual(['a', 'b'])
  })
})

describe('トラックと範囲の選択', () => {
  it('どちらも履歴の 1 段になり、元に戻せる', () => {
    const d = make({ tracks: [{ id: 't1', name: '1', volume: 0, pan: 0, mute: false, solo: false }, { id: 't2', name: '2', volume: 0, pan: 0, mute: false, solo: false }] })
    d.selectTracks(['t1', 't2'])
    d.selectRange({ start: 1, end: 2 })
    expect(d.selectedTracks).toEqual(['t1', 't2'])
    expect(d.range).toEqual({ start: 1, end: 2 })
    expect(d.store.get().past).toHaveLength(2)
    d.undo()
    expect(d.range).toBeNull()
    expect(d.selectedTracks).toEqual(['t1', 't2'])
    d.undo()
    expect(d.selectedTracks).toEqual([])
  })

  it('同じ範囲、同じトラックの選択は積まない。範囲のドラッグ（merge）は 1 段', () => {
    const d = make()
    d.selectRange({ start: 1, end: 2 }, 'range')
    d.selectRange({ start: 1, end: 3 }, 'range')
    d.selectRange({ start: 1, end: 3 }, 'range')
    expect(d.store.get().past).toHaveLength(1)
    expect(d.range).toEqual({ start: 1, end: 3 })
    d.selectTracks([])
    expect(d.store.get().past).toHaveLength(1)
  })

  it('消したトラックは選択から外れ、change の sel で範囲もいっしょに外せる', () => {
    const d = make({ tracks: [{ id: 't1', name: '1', volume: 0, pan: 0, mute: false, solo: false }] })
    d.selectTracks(['t1'])
    d.selectRange({ start: 0, end: 1 })
    d.change((p) => ({ ...p, tracks: [] }), undefined, { range: null })
    expect(d.selectedTracks).toEqual([])
    expect(d.range).toBeNull()
    expect(d.store.get().past.at(-1)?.range).toEqual({ start: 0, end: 1 })
    d.undo()
    expect(d.range).toEqual({ start: 0, end: 1 })
  })

  it('プロジェクトを変えずに選択だけを変えた change は select の名前になる', () => {
    const d = make()
    d.change((p) => p, undefined, { selected: ['a'] })
    expect(labels(d)).toEqual(['history.new', 'history.select'])
    expect(d.selected).toEqual(['a'])
  })
})

describe('begin', () => {
  it('途中の変更は 1 段で、commit で確定する', () => {
    const d = make()
    const tx = d.begin()
    tx.update((p) => ({ ...p, blocks: p.blocks.map((b) => ({ ...b, start: 1 })) }))
    tx.update((p) => ({ ...p, blocks: p.blocks.map((b) => ({ ...b, start: 2 })) }))
    expect(d.project.blocks[0].start).toBe(2)
    tx.commit()
    expect(d.store.get().past).toHaveLength(1)
    expect(labels(d)).toEqual(['history.new', 'history.move'])
  })

  it('cancel で、プロジェクトも選択も始める前に戻る', () => {
    const d = make()
    d.select(['a'])
    const before = d.store.get()
    const tx = d.begin()
    tx.update((p) => ({ ...p, blocks: [] }))
    expect(d.selected).toEqual([])
    tx.cancel()
    expect(d.store.get()).toBe(before)
    expect(d.selected).toEqual(['a'])
  })
})

describe('replace と setFxState', () => {
  it('replace は履歴を消し、名前を付ける', () => {
    const d = make()
    d.select(['a'])
    d.replace(newProject())
    expect(d.store.get().past).toEqual([])
    expect(d.selected).toEqual([])
    expect(labels(d)).toEqual(['history.open'])
  })

  it('setFxState は履歴に積まず、状態だけを入れる', () => {
    const slot = { plugin: 'x', values: {} } as never
    const base = newProject()
    const d = make({ master: { ...base.master, fx: [slot] } })
    d.setFxState('master', 0, 'abc')
    expect(d.project.master.fx?.[0].state).toBe('abc')
    expect(d.store.get().past).toEqual([])
    const before = d.store.get()
    d.setFxState('master', 0, 'abc')
    expect(d.store.get()).toBe(before)
  })
})
