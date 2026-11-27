// 中間の形（ほかの DAW から読んだもの）から Studio のプロジェクトを作る（memo/daw-exchange.md）。見つからない音声は無音の仮の音にして、missing に元のパスを残す
import { eqFreqs, eqToSlot, findPlugin, type Clip, type EqBands, type FxPlugin, type FxSlot } from 'wevocal-lib'
import type { XFx } from './rppFx'
import { jsToBuiltin } from './reaperBuiltin'
import { fillBlock, newId, newProject, newTrack, RATE_MAX, RATE_MIN, type Marker, type MidiBlock, type MidiCurve, type Project, type Source, type Block } from '../project'
import { notesOf, PPQ, type XClip, type XMidi, type XProject } from './exchange'
import { DEFAULT_REAPER_PITCH_MAP, reaperPitchKind, type ReaperPitchMap } from './reaperPitch'
import { ENV_MAX, ENV_MIN, PITCH_ENV_MAX } from '../envelopeCurve'

/** 仮の音の標本化周波数（無音なので低くてよい） */
const SILENT_RATE = 8000

/** パスの最後の名前（拡張子つき） */
export const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path

/** MIDI のイベントから、Studio の MIDI ブロックを作る（CC とピッチベンドは曲線の点） */
function midiBlock(m: XMidi, track: string): MidiBlock {
  const curves = new Map<string, MidiCurve>()
  for (const e of m.events) {
    const st = e.bytes[0] & 0xf0
    if (st === 0xb0) {
      const key = `cc${e.bytes[1]}`
      if (!curves.has(key)) curves.set(key, { kind: 'cc', cc: e.bytes[1], points: [] })
      curves.get(key)!.points.push({ t: e.tick / PPQ, v: e.bytes[2] / 127 })
    } else if (st === 0xe0) {
      if (!curves.has('bend')) curves.set('bend', { kind: 'bend', points: [] })
      curves.get('bend')!.points.push({ t: e.tick / PPQ, v: (((e.bytes[2] << 7) | e.bytes[1]) / 16383) * 2 - 1 })
    }
  }
  const notes = notesOf(m).map((n) => ({ id: newId(), t: n.time, dur: n.duration, pitch: n.key, vel: n.vel }))
  return { id: newId(), track, name: m.name || undefined, start: m.start, length: m.length, mute: m.mute, unit: 'beat', notes, ...(curves.size ? { curves: [...curves.values()] } : {}) }
}

/**
 * 中間の形からプロジェクトを作る。audio はファイルのパス → 音（見つからなければ無い）。
 * 返す missing は見つからなかったパスの数
 */
/** ReaEQ の帯を WevEQ にする。帯ごとに一番近い周波数（対数）の帯へ足す。幅の狭い（0.6 オクターブ未満の）帯があれば 31 帯 */
export function reaeqToSlot(fx: Extract<XFx, { kind: 'reaeq' }>): FxSlot {
  const bands: EqBands = fx.bands.some((b) => b.bw < 0.6) ? 31 : 10
  const freqs = eqFreqs(bands)
  const gains = freqs.map(() => 0)
  for (const b of fx.bands) {
    let best = 0
    freqs.forEach((f, i) => {
      if (Math.abs(Math.log2(f / b.freq)) < Math.abs(Math.log2(freqs[best] / b.freq))) best = i
    })
    gains[best] += b.gain
  }
  const range = gains.some((g) => Math.abs(g) > 12) ? 24 : 12
  return eqToSlot({ bands, gains: gains.map((g) => Math.round(Math.max(-range, Math.min(range, g)) * 10) / 10), on: fx.on, ...(range === 24 ? { range } : {}) })
}

/** VST の FX を、導入済みの VST から探す（識別番号、DLL の名前、プラグインの名前の順）。無ければ null */
export function vstToSlot(fx: Extract<XFx, { kind: 'vst' }>, installed: readonly FxPlugin[]): FxSlot | null {
  const vsts = installed.filter((p) => p.manifest.format === 'vst')
  const lower = (s: string) => s.toLowerCase()
  const nameOf = (p: FxPlugin) => String(p.lang?.en_us?.name ?? p.lang?.ja_jp?.name ?? '')
  const hit =
    (fx.uniqueId && vsts.find((p) => p.manifest.vst?.uniqueId === fx.uniqueId)) ||
    vsts.find((p) => p.manifest.vst && lower(p.manifest.vst.file) === lower(fx.file)) ||
    vsts.find((p) => lower(nameOf(p)) === lower(fx.name))
  if (!hit) return null
  const values: Record<string, number> = {}
  hit.manifest.params.forEach((d, i) => (values[d.id] = fx.params[i] ?? d.default))
  // 塊でしか状態を持たない VST は、塊を状態（base64）に入れる。つまみの値は開くときに VST から読む（importDaw）
  const state = fx.chunk ? btoa(Array.from(fx.chunk, (b) => String.fromCharCode(b)).join('')) : undefined
  return { plugin: hit.manifest.id, version: hit.manifest.version, on: fx.on, values, ...(state ? { state } : {}) }
}

/** 中間の形のクリップのピッチの処理方式とエンベロープを、波形ブロックの項目にする（処理方式は対応表で、エンベロープは元の音の時刻へ） */
export function clipExtras(c: XClip, rate: number, pitchMap: ReaperPitchMap): Partial<Block> {
  const out: Partial<Block> = {}
  if (c.pitchMode !== undefined) Object.assign(out, pitchMap[c.pitchMode === -1 ? 'other' : reaperPitchKind(c.pitchMode)])
  if (c.pitchEnv?.length)
    out.pitchEnvelope = c.pitchEnv.map((p) => ({ s: c.offset + p.t * rate, st: Math.max(-PITCH_ENV_MAX, Math.min(PITCH_ENV_MAX, p.v)), ...(p.shape ? { shape: p.shape } : {}), ...(p.tension ? { tension: p.tension } : {}) }))
  if (c.volEnv?.length) out.envelope = c.volEnv.map((p) => ({ t: p.t, db: Math.max(ENV_MIN, Math.min(ENV_MAX, p.v)), ...(p.shape ? { shape: p.shape } : {}), ...(p.tension ? { tension: p.tension } : {}) }))
  return out
}

/** 知っている JSFX を Studio の組み込みの FX にする（足りない値は既定値）。知らないものは null */
export function jsToSlot(fx: Extract<XFx, { kind: 'js' }>): FxSlot | null {
  const r = jsToBuiltin(fx)
  const m = r && findPlugin(r.plugin)?.manifest
  if (!r || !m) return null
  const values: Record<string, number> = {}
  for (const d of m.params) values[d.id] = Number.isFinite(r.values[d.id]) ? r.values[d.id] : d.default
  return { plugin: m.id, version: m.version, on: fx.on, values }
}

export function fromExchange(x: XProject, audio: Map<string, Clip>, installed: readonly FxPlugin[] = [], pitchMap: ReaperPitchMap = DEFAULT_REAPER_PITCH_MAP): { project: Project; missing: number; skippedFx: number } {
  let skippedFx = 0
  const p = newProject(x.bpm)
  p.tempo = { ...p.tempo, bpm: x.bpm, beatsPerBar: x.beatsPerBar }
  p.master = { ...p.master, ...x.master }
  // マーカーと途中のテンポの変化（同じ位置にマーカーがあれば、そのマーカーにテンポを持たせる）
  const markers: Marker[] = x.markers.map((m) => ({ id: newId(), time: m.time, name: m.name }))
  for (const t of x.tempos) {
    const same = markers.find((m) => Math.abs(m.time - t.time) < 1e-6)
    const tempo = { bpm: t.bpm, beatsPerBar: t.beatsPerBar }
    if (same) same.tempo = tempo
    else markers.push({ id: newId(), time: t.time, name: '', tempo })
  }
  p.markers = markers.sort((a, b) => a.time - b.time)

  // 使う長さ（仮の音の長さを決める）
  const need = new Map<string, number>()
  for (const t of x.tracks) for (const c of t.clips) need.set(c.file, Math.max(need.get(c.file) ?? 0, c.offset + c.length * c.rate))
  const sources = new Map<string, Source>()
  let missing = 0
  for (const [file, dur] of need) {
    const clip = audio.get(file)
    const name = baseName(file)
    if (clip) sources.set(file, { id: newId(), name, clip, duration: clip.channels[0].length / clip.sampleRate })
    else {
      missing++
      const frames = Math.max(1, Math.ceil(dur * SILENT_RATE))
      sources.set(file, { id: newId(), name, clip: { sampleRate: SILENT_RATE, channels: [new Float32Array(frames)] }, duration: frames / SILENT_RATE, missing: file })
    }
  }
  p.sources = [...sources.values()]

  // トラック（深さから親を決める）
  p.tracks = []
  p.blocks = []
  const midi: MidiBlock[] = []
  const parents: string[] = []
  x.tracks.forEach((t, i) => {
    parents.length = Math.min(parents.length, t.depth)
    const track = { ...newTrack(i + 1), name: t.name || `Track ${i + 1}`, volume: t.volume, pan: t.pan, mute: t.mute, solo: t.solo, ...(t.invert ? { invert: true } : {}), ...(parents.length ? { parent: parents[parents.length - 1] } : {}) }
    p.tracks.push(track)
    parents[t.depth] = track.id
    for (const c of t.clips) {
      const s = sources.get(c.file)!
      const rate = Math.max(RATE_MIN, Math.min(RATE_MAX, c.rate))
      p.blocks.push(
        fillBlock({ id: newId(), track: track.id, source: s.id, start: c.start, length: c.length, offset: c.offset, rate, gain: c.gain, pitch: c.pitch, fadeIn: c.fadeIn, fadeOut: c.fadeOut, mute: c.mute, ...(c.name ? { name: c.name } : {}), ...clipExtras(c, rate, pitchMap) }),
      )
    }
    for (const m of t.midi) midi.push(midiBlock(m, track.id))
    const slots: FxSlot[] = []
    for (const fx of t.fx ?? []) {
      const s = fx.kind === 'reaeq' ? reaeqToSlot(fx) : fx.kind === 'js' ? jsToSlot(fx) : vstToSlot(fx, installed)
      if (s) slots.push(s)
      else skippedFx++
    }
    if (slots.length) track.fx = slots
  })
  if (!p.tracks.length) p.tracks = [newTrack(1)]
  if (midi.length) p.midi = midi
  return { project: p, missing, skippedFx }
}

/** 見つからなかった音声（missing のある Source）に音を割り当てる。ブロックの位置と範囲はそのまま */
export function assignAudio(p: Project, source: string, clip: Clip, name: string): Project {
  // 新しい id にする（ピッチを変えた音や波形のキャッシュは元の音の id で引くので、同じ id のままだと仮の無音から作ったものが残る）
  const id = newId()
  return {
    ...p,
    sources: p.sources.map((s) => (s.id === source ? { id, name, clip, duration: clip.channels[0].length / clip.sampleRate } : s)),
    blocks: p.blocks.map((b) => (b.source === source ? { ...b, source: id } : b)),
    // トラックの音源の音と、固定した音も同じ元の音を指していれば付け替える
    tracks: p.tracks.map((t) => (t.instrument?.sample === source || t.frozen?.source === source ? { ...t, ...(t.instrument?.sample === source ? { instrument: { ...t.instrument, sample: id } } : {}), ...(t.frozen?.source === source ? { frozen: { ...t.frozen, source: id } } : {}) } : t)),
  }
}

/**
 * 見つからなかった音声のパスに、フォルダーの中のファイル（フォルダーからの相対パス）を当てる。
 * パスの後ろからより多くの部分が一致するもの（Audio/a.wav なら、Audio/a.wav を a.wav より先）を選ぶ。大文字と小文字、\ と / は区別しない
 */
export function matchAudio<F>(missing: string[], files: { path: string; file: F }[]): Map<string, F> {
  const norm = (s: string) => s.replace(/\\/g, '/').toLowerCase()
  const list = files.map((f) => ({ path: `/${norm(f.path)}`, file: f.file }))
  const out = new Map<string, F>()
  for (const m of missing) {
    const parts = norm(m).split('/').filter(Boolean)
    for (let k = parts.length; k >= 1; k--) {
      const tail = `/${parts.slice(-k).join('/')}`
      const hit = list.find((f) => f.path.endsWith(tail))
      if (hit) {
        out.set(m, hit.file)
        break
      }
    }
  }
  return out
}

/** 見つからなかった音声にまとめて音を割り当てる（1 回の変更にする） */
export const assignAudios = (p: Project, list: { source: string; clip: Clip; name: string }[]): Project => list.reduce((q, a) => assignAudio(q, a.source, a.clip, a.name), p)
