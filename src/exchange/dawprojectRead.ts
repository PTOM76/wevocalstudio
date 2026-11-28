// DAWproject の project.xml を読み、中間の形にする（memo/daw-exchange.md）。拍で書かれた時間はテンポ（途中の変化を含む）で秒に直す。音声はファイルのパスのまま返す
import { PPQ, type XClip, type XMidi, type XProject, type XTrack } from './exchange'
import { child, childrenOf, numAttr, parseXml, type XmlNode } from './xml'

const gainToDb = (g: number) => (g <= 0 ? -60 : Math.max(-60, 20 * Math.log10(g)))

/** テンポの区間（拍の位置で並べる）で、拍と秒を変換する */
function timeMap(bpm: number, changes: { time: number; bpm: number }[], unit: 'beats' | 'seconds') {
  // changes の time は unit の単位。区間ごとの始まりの秒と拍を積み上げる
  const segs = [{ beat: 0, sec: 0, bpm }]
  for (const c of [...changes].sort((a, b) => a.time - b.time)) {
    const last = segs[segs.length - 1]
    if (unit === 'beats') segs.push({ beat: c.time, sec: last.sec + ((c.time - last.beat) * 60) / last.bpm, bpm: c.bpm })
    else segs.push({ beat: last.beat + ((c.time - last.sec) * last.bpm) / 60, sec: c.time, bpm: c.bpm })
  }
  const toSec = (beat: number) => {
    let s = segs[0]
    for (const x of segs) if (x.beat <= beat) s = x
    return s.sec + ((beat - s.beat) * 60) / s.bpm
  }
  const toBeat = (sec: number) => {
    let s = segs[0]
    for (const x of segs) if (x.sec <= sec) s = x
    return s.beat + ((sec - s.sec) * s.bpm) / 60
  }
  return { toSec, toBeat, tempos: segs.slice(1).map((s) => ({ time: s.sec, bpm: s.bpm })) }
}

export function readDawproject(xml: string): { project: XProject; notes: { skippedClips: number } } {
  const proj = child(parseXml(xml), 'Project')
  if (!proj) throw new Error('not a DAWproject')
  const transport = child(proj, 'Transport')
  const bpm = numAttr(child(transport, 'Tempo'), 'value', 120)
  const beatsPerBar = Math.round(numAttr(child(transport, 'TimeSignature'), 'numerator', 4)) || 4
  const arr = child(proj, 'Arrangement')
  const lanesRoot = child(arr, 'Lanes')
  const rootUnit = lanesRoot?.attrs.timeUnit === 'seconds' ? 'seconds' : 'beats'
  const auto = child(arr, 'TempoAutomation')
  const autoUnit = auto?.attrs.timeUnit === 'seconds' ? 'seconds' : rootUnit
  const map = timeMap(
    bpm,
    childrenOf(auto, 'RealPoint')
      .filter((p) => numAttr(p, 'time') > 0)
      .map((p) => ({ time: numAttr(p, 'time'), bpm: numAttr(p, 'value', bpm) })),
    autoUnit,
  )
  const sec = (v: number, unit: string) => (unit === 'seconds' ? v : map.toSec(v))
  let skippedClips = 0

  // トラック（入れ子を深さにする）
  const tracks: XTrack[] = []
  const byId = new Map<string, XTrack>()
  const walk = (n: XmlNode, depth: number) => {
    for (const t of childrenOf(n, 'Track')) {
      const ch = child(t, 'Channel')
      const vol = child(ch, 'Volume')
      const pan = child(ch, 'Pan')
      const x: XTrack = {
        name: t.attrs.name ?? '',
        volume: vol?.attrs.unit === 'decibel' ? numAttr(vol, 'value') : gainToDb(numAttr(vol, 'value', 1)),
        pan: pan?.attrs.unit === 'normalized' || !pan?.attrs.unit ? numAttr(pan, 'value', 0.5) * 2 - 1 : numAttr(pan, 'value'),
        mute: child(ch, 'Mute')?.attrs.value === 'true',
        solo: ch?.attrs.solo === 'true',
        invert: false,
        depth,
        clips: [],
        midi: [],
      }
      // FX の列（VST だけ。状態はプリセットのファイルで、中身は読み込みの側で読む）
      const fx: NonNullable<XTrack['fx']> = []
      for (const d of child(ch, 'Devices')?.children ?? []) {
        if (d.tag !== 'Vst2Plugin' && d.tag !== 'Vst3Plugin') continue
        const vst3 = d.tag === 'Vst3Plugin'
        const id = d.attrs.deviceID ?? ''
        const on = child(d, 'Enabled')?.attrs.value !== 'false'
        fx.push({ kind: 'vst', on, name: d.attrs.deviceName ?? '', file: '', uniqueId: vst3 ? 0 : Number(id) >>> 0, params: [], ...(vst3 ? { cid: id.toUpperCase() } : {}), ...(child(d, 'State')?.attrs.path ? { statePath: child(d, 'State')!.attrs.path } : {}) })
      }
      if (fx.length) x.fx = fx
      tracks.push(x)
      if (t.attrs.id) byId.set(t.attrs.id, x)
      walk(t, depth + 1)
    }
  }
  walk(child(proj, 'Structure')!, 0)

  /** クリップの中身を読む。unit はクリップの位置の単位 */
  const readClip = (c: XmlNode, unit: string, track: XTrack) => {
    const start = sec(numAttr(c, 'time'), unit)
    const end = sec(numAttr(c, 'time') + numAttr(c, 'duration'), unit)
    const fadeUnit = c.attrs.fadeTimeUnit ?? unit
    const fade = (key: string) => {
      const v = numAttr(c, key)
      return fadeUnit === 'seconds' ? v : map.toSec(numAttr(c, 'time') + v) - start
    }
    const base = { name: c.attrs.name ?? '', start, length: end - start, mute: c.attrs.enable === 'false' }
    const notes = child(c, 'Notes')
    if (notes) {
      const events: XMidi['events'] = []
      for (const n of childrenOf(notes, 'Note')) {
        const t0 = Math.round((numAttr(n, 'time') - numAttr(c, 'playStart')) * PPQ)
        const t1 = t0 + Math.round(numAttr(n, 'duration') * PPQ)
        if (t1 <= 0) continue
        const key = Math.round(numAttr(n, 'key', 60))
        events.push({ tick: Math.max(0, t0), bytes: [0x90, key, Math.max(1, Math.min(127, Math.round(numAttr(n, 'vel', 0.8) * 127)))] }, { tick: t1, bytes: [0x80, key, 0] })
      }
      events.sort((a, b) => a.tick - b.tick || a.bytes[0] - b.bytes[0])
      track.midi.push({ ...base, ticks: Math.round((map.toBeat(end) - map.toBeat(start)) * PPQ), events })
      return
    }
    // 表現の点（移調、音量）があると、中身は Lanes で包まれている
    const inner = child(c, 'Lanes') ?? c
    const warps = child(inner, 'Warps')
    const audio = child(warps ?? inner, 'Audio')
    const expr = (name: string) =>
      childrenOf(inner, 'Points')
        .filter((pt) => child(pt, 'Target')?.attrs.expression === name)
        .flatMap((pt) => childrenOf(pt, 'RealPoint').map((r) => ({ t: numAttr(r, 'time'), v: numAttr(r, 'value'), ...(r.attrs.interpolation === 'hold' ? { shape: 'square' as const } : {}) })))
        .sort((a, b) => a.t - b.t)
    const transpose = expr('transpose')
    const gains = expr('gain')
    const file = child(audio, 'File')?.attrs.path
    if (!file) {
      skippedClips++
      return
    }
    // 元の音の開始と速度。Warps があれば最初と最後の点から、なければ playStart（中身の単位）から
    let offset = numAttr(c, 'playStart')
    let rate = 1
    const pts = childrenOf(warps, 'Warp')
    if (warps && pts.length >= 2) {
      const wUnit = warps.attrs.timeUnit ?? unit
      const cUnit = warps.attrs.contentTimeUnit ?? 'seconds'
      const ws = (v: number) => (wUnit === 'seconds' ? v : map.toSec(numAttr(c, 'time') + v) - start)
      const cs = (v: number) => (cUnit === 'seconds' ? v : (v * 60) / bpm)
      const a = pts[0]
      const b = pts[pts.length - 1]
      const span = ws(numAttr(b, 'time')) - ws(numAttr(a, 'time'))
      rate = span > 0 ? (cs(numAttr(b, 'contentTime')) - cs(numAttr(a, 'contentTime'))) / span : 1
      // 時刻 0 にあたる中身の位置に、playStart（時刻の単位）を足す
      const at0 = cs(numAttr(a, 'contentTime')) - ws(numAttr(a, 'time')) * rate
      offset = at0 + ws(numAttr(c, 'playStart')) * rate
    } else if ((c.attrs.contentTimeUnit ?? unit) !== 'seconds') offset = (offset * 60) / bpm
    // 移調の点が 1 つ（か全部同じ値）なら一定のピッチ、変わるならエンベロープ
    const flat = transpose.length > 0 && transpose.every((p) => p.v === transpose[0].v)
    const clip: XClip = {
      ...base,
      file,
      offset: Math.max(0, offset),
      gain: 0,
      fadeIn: fade('fadeInTime'),
      fadeOut: fade('fadeOutTime'),
      rate: rate > 0 ? rate : 1,
      pitch: flat ? transpose[0].v : 0,
      ...(transpose.length && !flat ? { pitchEnv: transpose } : {}),
      ...(gains.length ? { volEnv: gains.map((p) => ({ ...p, v: p.v <= 0 ? -60 : Math.max(-60, 20 * Math.log10(p.v)) })) } : {}),
    }
    track.clips.push(clip)
  }

  /** レーン（入れ子のことがある）の中のクリップを読む */
  const readLanes = (lanes: XmlNode, unit: string, track: XTrack | undefined) => {
    const u = lanes.attrs.timeUnit ?? unit
    const tr = (lanes.attrs.track && byId.get(lanes.attrs.track)) || track
    for (const k of lanes.children) {
      if (k.tag === 'Lanes') readLanes(k, u, tr)
      else if (k.tag === 'Clips' && tr) for (const c of childrenOf(k, 'Clip')) readClip(c, k.attrs.timeUnit ?? u, tr)
      else if (k.tag === 'Clips') skippedClips += childrenOf(k, 'Clip').length
    }
  }
  if (lanesRoot) readLanes(lanesRoot, rootUnit, undefined)

  const markers = childrenOf(child(arr, 'Markers'), 'Marker').map((m) => ({ time: sec(numAttr(m, 'time'), child(arr, 'Markers')?.attrs.timeUnit ?? rootUnit), name: m.attrs.name ?? '' }))
  return {
    project: { bpm, beatsPerBar, markers, tempos: map.tempos.map((t) => ({ ...t, beatsPerBar })), master: { volume: 0, pan: 0, mute: false }, tracks, files: new Map() },
    notes: { skippedClips },
  }
}
