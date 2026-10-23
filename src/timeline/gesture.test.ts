// timeline/gesture.ts のテスト
import { describe, expect, it } from 'vitest'
import { gestureSlots, type Gesture } from './gesture'

const make = () => {
  const ref: { current: Gesture | null } = { current: null }
  return { ref, ...gestureSlots(ref) }
}

describe('gestureSlots', () => {
  it('種類ごとに読み書きでき、書いた種類以外は null', () => {
    const g = make()
    g.rangeDrag.current = { t: 1, x: 10 }
    expect(g.rangeDrag.current).toEqual({ t: 1, x: 10 })
    expect(g.marquee.current).toBeNull()
    expect(g.ref.current?.type).toBe('range')
  })

  it('新しい操作を始めると、前の操作は終わる（同時に 2 つ立たない）', () => {
    const g = make()
    g.marquee.current = { x: 0, y: 0, moved: false }
    g.pan.current = { x0: 1, y0: 2, scroll0: 0, v0: 0 }
    expect(g.marquee.current).toBeNull()
    expect(g.pan.current).not.toBeNull()
  })

  it('null を書くのは、その種類のときだけ効く（別の操作は終わらせない）', () => {
    const g = make()
    g.envDrag.current = { block: 'a', index: 0, merge: 'env1' }
    g.pan.current = null
    expect(g.envDrag.current).not.toBeNull()
    g.envDrag.current = null
    expect(g.ref.current).toBeNull()
  })

  it('目盛りの操作（scrub）は、true と false で始める、終わる', () => {
    const g = make()
    expect(g.scrub.current).toBe(false)
    g.scrub.current = true
    expect(g.scrub.current).toBe(true)
    g.envDrag.current = { block: 'a', index: 0, merge: 'x' }
    expect(g.scrub.current).toBe(false)
    g.scrub.current = false
    expect(g.envDrag.current).not.toBeNull()
  })
})
