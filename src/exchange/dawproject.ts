// DAWproject（.dawproject。zip の中に project.xml、metadata.xml、音声）の XML を書く（memo/daw-exchange.md）。時間軸は秒、MIDI の音符は拍。親と子は入れ子の Track（親はサブミックス）
import { notesOf, type XProject, type XTrack } from './exchange'
import type { XEnvPoint } from './reaperPitch'
import { fxp, vstPreset } from './vstPreset'

const dbToGain = (db: number) => (db <= -150 ? 0 : 10 ** (db / 20))
const num = (v: number) => (Number.isFinite(v) ? String(Math.round(v * 1e9) / 1e9) : '0')
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

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
    devices(t)
    line(`<Mute value="${t.mute}" id="${id()}"/>`)
    line(`<Pan unit="normalized" value="${num((t.pan + 1) / 2)}" min="0" max="1" id="${id()}"/>`)
    line(`<Volume unit="linear" value="${num(dbToGain(t.volume))}" min="0" max="2" id="${id()}"/>`)
    close('Channel')
  }
  // FX の列（VST だけ）。状態はプリセットのファイル（plugins/ の .vstpreset、.fxp）にして zip に入れる
  let preset = 0
  const devices = (t: XTrack) => {
    const vsts = (t.fx ?? []).filter((f) => f.kind === 'vst')
    if (!vsts.length) return
    open('Devices')
    for (const f of vsts) {
      const tag = f.cid ? 'Vst3Plugin' : 'Vst2Plugin'
      const path = `plugins/${++preset}.${f.cid ? 'vstpreset' : 'fxp'}`
      const data = f.cid && f.chunk ? vstPreset(f.cid, f.chunk) : fxp(f)
      p.files.set(path, new Blob([data as Uint8Array<ArrayBuffer>]))
      open(`${tag} deviceID="${esc(f.cid ?? String(f.uniqueId >>> 0))}" deviceName="${esc(f.name)}" deviceRole="audioFX" loaded="true" id="${id()}"`)
      line(`<Enabled value="${f.on}" id="${id()}"/>`)
      line(`<State path="${path}"/>`)
      close(tag)
    }
    close('Devices')
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
      // ピッチ（一定の値とエンベロープ）と音量のエンベロープは、クリップの中の表現の点（Points）にする。そのときは中身を Lanes で包む
      const transpose = c.pitchEnv?.length ? c.pitchEnv.map((p) => ({ ...p, v: c.pitch + p.v })) : c.pitch ? [{ t: 0, v: c.pitch }] : []
      const gainPts = (c.volEnv ?? []).map((p) => ({ ...p, v: 10 ** (p.v / 20) }))
      const wrap = transpose.length > 0 || gainPts.length > 0
      if (wrap) open(`Lanes timeUnit="seconds" id="${id()}"`)
      open(`Warps timeUnit="seconds" contentTimeUnit="seconds" id="${id()}"`)
      open(`Audio algorithm="stretch" channels="2" id="${id()}"`)
      line(`<File path="${esc(c.file)}"/>`)
      close('Audio')
      line(`<Warp time="0" contentTime="${num(c.offset)}"/>`)
      line(`<Warp time="${num(c.length)}" contentTime="${num(c.offset + c.length * c.rate)}"/>`)
      close('Warps')
      const points = (expression: string, unit: string, pts: XEnvPoint[]) => {
        if (!pts.length) return
        open(`Points unit="${unit}" id="${id()}"`)
        line(`<Target expression="${expression}"/>`)
        for (const p of pts) line(`<RealPoint time="${num(p.t)}" value="${num(p.v)}" interpolation="${p.shape === 'square' ? 'hold' : 'linear'}"/>`)
        close('Points')
      }
      points('transpose', 'semitones', transpose)
      points('gain', 'linear', gainPts)
      if (wrap) close('Lanes')
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

