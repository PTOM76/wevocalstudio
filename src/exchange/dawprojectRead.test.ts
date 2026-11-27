// dawprojectRead.ts のテスト（dawproject.ts で書いたものを読むと元に戻る、拍で書いたもの、XML の読み取り）
import { describe, expect, it } from 'vitest'
import { writeDawproject } from './dawproject'
import { readDawproject } from './dawprojectRead'
import { PPQ, type XProject } from './exchange'
import { parseXml } from './xml'

const x: XProject = {
  bpm: 120,
  beatsPerBar: 4,
  markers: [{ time: 3, name: 'A & B' }],
  tempos: [],
  master: { volume: 0, pan: 0, mute: false },
  tracks: [
    { name: '親', volume: 0, pan: 0, mute: false, solo: false, invert: false, depth: 0, clips: [], midi: [] },
    {
      name: '子',
      volume: -6,
      pan: -0.5,
      mute: true,
      solo: true,
      invert: false,
      depth: 1,
      clips: [{ name: 'a', start: 1, length: 2, file: 'audio/a.wav', offset: 0.5, gain: 0, fadeIn: 0.01, fadeOut: 0.02, rate: 1.5, pitch: 0, mute: false }],
      midi: [{ name: 'm', start: 0, length: 2, mute: false, ticks: 4 * PPQ, events: [{ tick: 0, bytes: [0x90, 60, 127] }, { tick: PPQ, bytes: [0x80, 60, 0] }] }],
    },
  ],
  files: new Map(),
}
const near = (v: number) => Math.round(v * 1e6) / 1e6

describe('readDawproject', () => {
  it('書いたものを読むと元に戻る', () => {
    const { project } = readDawproject(writeDawproject(x, { name: 't', version: '1' }))
    expect(project.markers).toEqual(x.markers)
    expect(project.tracks.map((t) => [t.name, t.depth])).toEqual([
      ['親', 0],
      ['子', 1],
    ])
    const t = project.tracks[1]
    expect([near(t.volume), t.pan, t.mute, t.solo]).toEqual([-6, -0.5, true, true])
    expect(t.clips.map((c) => ({ ...c, offset: near(c.offset), rate: near(c.rate) }))).toEqual(x.tracks[1].clips)
    expect(t.midi).toEqual(x.tracks[1].midi)
  })

  it('拍で書いた位置と長さを、テンポの変化で秒に直す', () => {
    const xml = `<Project version="1.0"><Transport><Tempo unit="bpm" value="120"/></Transport>
      <Structure><Track id="t" name="v"><Channel><Volume unit="linear" value="1"/></Channel></Track></Structure>
      <Arrangement><TempoAutomation unit="bpm"><RealPoint time="4" value="60" interpolation="hold"/></TempoAutomation>
      <Lanes timeUnit="beats"><Lanes track="t"><Clips><Clip time="2" duration="4" playStart="1" contentTimeUnit="beats"><Audio><File path="x.wav"/></Audio></Clip></Clips></Lanes></Lanes></Arrangement></Project>`
    const { project } = readDawproject(xml)
    // 2 拍目 = 1 秒。4 拍目まで 120 BPM（1 秒）、そのあと 60 BPM で 2 拍（2 秒）
    const c = project.tracks[0].clips[0]
    expect([c.start, c.length, c.offset]).toEqual([1, 3, 0.5])
    expect(project.tempos).toEqual([{ time: 2, bpm: 60, beatsPerBar: 4 }])
  })
})

describe('parseXml', () => {
  it('属性の文字参照、自分で閉じるタグ、コメントを読む', () => {
    const r = parseXml(`<?xml version="1.0"?><!-- c --><a x="1 &amp; 2"><b/><c>t&lt;</c></a>`)
    const a = r.children[0]
    expect(a.attrs.x).toBe('1 & 2')
    expect(a.children.map((c) => c.tag)).toEqual(['b', 'c'])
    expect(a.children[1].text).toBe('t<')
  })
})
