// DAWproject（.dawproject。zip の中に project.xml、metadata.xml、音声）の XML を書く（memo/daw-exchange.md）。時間軸は秒、MIDI の音符は拍。親と子は入れ子の Track（親はサブミックス）
import { PPQ, type XMidi, type XProject, type XTrack } from './exchange'

const dbToGain = (db: number) => (db <= -150 ? 0 : 10 ** (db / 20))
const num = (v: number) => (Number.isFinite(v) ? String(Math.round(v * 1e9) / 1e9) : '0')
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** MIDI のイベントから音符（拍）を組み立てる。押したまま終わる音は終わりで切る */
export function notesOf(m: XMidi): { time: number; duration: number; key: number; vel: number }[] {
  const on = new Map<number, { tick: number; vel: number }[]>()
  const out: { time: number; duration: number; key: number; vel: number }[] = []
  const end = (key: number, tick: number) => {
    const s = on.get(key)?.shift()
    if (s) out.push({ time: s.tick / PPQ, duration: (tick - s.tick) / PPQ, key, vel: s.vel / 127 })
  }
  for (const e of m.events) {
    const [st, key, vel] = e.bytes
    if (st === 0x90 && vel > 0) on.set(key, [...(on.get(key) ?? []), { tick: e.tick, vel }])
    else if (st === 0x80 || (st === 0x90 && vel === 0)) end(key, e.tick)
  }
  for (const [key, list] of on) for (let i = list.length; i > 0; i--) end(key, m.ticks)
  return out.sort((a, b) => a.time - b.time || a.key - b.key)
}

export function writeDawproject(p: XProject, app: { name: string; version: string }): string {
  let next = 0
  const id = () => `id${next++}`
  const out: string[] = ['<?xml version="1.0" encoding="UTF-8"?>']
  let depth = 0
  const line = (s: string) => out.push(`${'  '.repeat(depth)}${s}`)
  const open = (s: string) => {
    line(`<${s}>`)
    depth++
  }
  const close = (tag: string) => {
    depth--
    line(`</${tag}>`)
  }

  open('Project version="1.0"')
  line(`<Application name="${esc(app.name)}" version="${esc(app.version)}"/>`)
  open('Transport')
  line(`<Tempo unit="bpm" value="${num(p.bpm)}" id="${id()}"/>`)
  line(`<TimeSignature numerator="${p.beatsPerBar}" denominator="4" id="${id()}"/>`)
  close('Transport')

  // トラックの id（レーンから指す）
  const trackIds = p.tracks.map(() => id())
  const channel = (t: XTrack, submix: boolean) => {
    open(`Channel role="${submix ? 'submix' : 'regular'}" audioChannels="2" solo="${t.solo}" id="${id()}"`)
    line(`<Mute value="${t.mute}" id="${id()}"/>`)
    line(`<Pan unit="normalized" value="${num((t.pan + 1) / 2)}" min="0" max="1" id="${id()}"/>`)
    line(`<Volume unit="linear" value="${num(dbToGain(t.volume))}" min="0" max="2" id="${id()}"/>`)
    close('Channel')
  }
  open('Structure')
  // 深さの順に入れ子にする（親のすぐ後に子が続く並び）
  const stack: number[] = []
  p.tracks.forEach((t, i) => {
    while (stack.length && p.tracks[stack[stack.length - 1]].depth >= t.depth) {
      stack.pop()
      close('Track')
    }
    const hasKids = (p.tracks[i + 1]?.depth ?? -1) > t.depth
    const kinds = [t.clips.length ? 'audio' : '', t.midi.length ? 'notes' : '', hasKids ? 'tracks' : ''].filter(Boolean).join(' ') || 'audio'
    open(`Track contentType="${kinds}" loaded="true" name="${esc(t.name)}" id="${trackIds[i]}"`)
    channel(t, hasKids)
    stack.push(i)
  })
  while (stack.pop() !== undefined) close('Track')
  close('Structure')

  open(`Arrangement id="${id()}"`)
  if (p.tempos.length) {
    open(`TempoAutomation unit="bpm" id="${id()}"`)
    line(`<RealPoint time="0" value="${num(p.bpm)}" interpolation="hold"/>`)
    for (const t of p.tempos) line(`<RealPoint time="${num(t.time)}" value="${num(t.bpm)}" interpolation="hold"/>`)
    close('TempoAutomation')
  }
  if (p.markers.length) {
    open(`Markers id="${id()}"`)
    for (const m of p.markers) line(`<Marker time="${num(m.time)}" name="${esc(m.name)}" id="${id()}"/>`)
    close('Markers')
  }
  open(`Lanes timeUnit="seconds" id="${id()}"`)
  p.tracks.forEach((t, i) => {
    if (!t.clips.length && !t.midi.length) return
    open(`Lanes track="${trackIds[i]}" id="${id()}"`)
    open(`Clips id="${id()}"`)
    for (const c of t.clips) {
      // 元の音の開始と速度は伸縮の対応点（Warps）で表す。ゲインはクリップに無いので、描画した音に含める（exchange.ts）
      open(`Clip time="${num(c.start)}" duration="${num(c.length)}" playStart="0" fadeTimeUnit="seconds" fadeInTime="${num(c.fadeIn)}" fadeOutTime="${num(c.fadeOut)}" enable="${!c.mute}" name="${esc(c.name)}"`)
      open(`Warps timeUnit="seconds" contentTimeUnit="seconds" id="${id()}"`)
      open(`Audio algorithm="stretch" channels="2" id="${id()}"`)
      line(`<File path="${esc(c.file)}"/>`)
      close('Audio')
      line(`<Warp time="0" contentTime="${num(c.offset)}"/>`)
      line(`<Warp time="${num(c.length)}" contentTime="${num(c.offset + c.length * c.rate)}"/>`)
      close('Warps')
      close('Clip')
    }
    for (const m of t.midi) {
      open(`Clip time="${num(m.start)}" duration="${num(m.length)}" contentTimeUnit="beats" playStart="0" enable="${!m.mute}" name="${esc(m.name)}"`)
      open(`Notes id="${id()}"`)
      for (const n of notesOf(m)) line(`<Note time="${num(n.time)}" duration="${num(n.duration)}" channel="0" key="${n.key}" vel="${num(n.vel)}" rel="0.5"/>`)
      close('Notes')
      close('Clip')
    }
    close('Clips')
    close('Lanes')
  })
  close('Lanes')
  close('Arrangement')
  close('Project')
  return out.join('\n') + '\n'
}

export const writeMetadata = (title: string) => `<?xml version="1.0" encoding="UTF-8"?>\n<MetaData>\n  <Title>${esc(title)}</Title>\n</MetaData>\n`

