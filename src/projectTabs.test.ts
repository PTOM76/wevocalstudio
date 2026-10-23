// projectTabs.ts のテスト
import { describe, expect, it } from 'vitest'
import { newProject } from './project'
import { isBlank, isDirty, neighborAfterClose } from './projectTabs'

describe('neighborAfterClose', () => {
  it('右隣、なければ左隣、ほかになければ null', () => {
    expect(neighborAfterClose(['a', 'b', 'c'], 'b')).toBe('c')
    expect(neighborAfterClose(['a', 'b', 'c'], 'c')).toBe('b')
    expect(neighborAfterClose(['a'], 'a')).toBeNull()
    expect(neighborAfterClose(['a', 'b'], 'x')).toBeNull()
  })
})

describe('isDirty と isBlank', () => {
  const empty = newProject()
  const withBlock = { ...empty, blocks: [{ id: 'b' } as never] }

  it('同じプロジェクトは変更なし。空のプロジェクトどうしの違いも、変更なしとみなす', () => {
    expect(isDirty(empty, empty)).toBe(false)
    expect(isDirty({ ...empty }, empty)).toBe(false)
  })

  it('ブロックを足したら変更あり。保存したあとに空にしても変更あり', () => {
    expect(isDirty(withBlock, empty)).toBe(true)
    expect(isDirty(empty, withBlock)).toBe(true)
    expect(isDirty(withBlock, withBlock)).toBe(false)
  })

  it('何も置いていない保存済みのプロジェクトだけが、空', () => {
    expect(isBlank(empty, false)).toBe(true)
    expect(isBlank(empty, true)).toBe(false)
    expect(isBlank(withBlock, false)).toBe(false)
    expect(isBlank({ ...empty, tracks: [...empty.tracks, { ...empty.tracks[0], id: 'x' }] }, false)).toBe(false)
  })
})
