// project.ts の audible と ownAudible（ミュートとソロ）のテスト
import { describe, expect, it } from 'vitest'
import { audible, newProject, ownAudible, type Project, type Track } from './project'

const track = (id: string, patch: Partial<Track> = {}): Track => ({ id, name: id, volume: 0, pan: 0, mute: false, solo: false, ...patch })
const project = (tracks: Track[]): Project => ({ ...newProject(), tracks })
const own = (p: Project) => p.tracks.filter((t) => ownAudible(p, t)).map((t) => t.id)

describe('ソロとミュート', () => {
  it('ソロの親の子は鳴るが、ミュートした子は鳴らさない', () => {
    const p = project([track('a', { solo: true }), track('b', { parent: 'a' }), track('c', { parent: 'a', mute: true }), track('d')])
    expect(own(p)).toEqual(['a', 'b'])
  })

  it('途中の親がミュートなら、その下の子も鳴らさない', () => {
    const p = project([track('a', { solo: true }), track('b', { parent: 'a', mute: true }), track('c', { parent: 'b' })])
    expect(own(p)).toEqual(['a'])
  })

  it('子がソロなら、ミュートしていても鳴る（ソロが優先）。親は通すだけ', () => {
    const p = project([track('a'), track('b', { parent: 'a', solo: true, mute: true })])
    expect(own(p)).toEqual(['b'])
    expect(audible(p, p.tracks[0])).toBe(true)
  })
})
