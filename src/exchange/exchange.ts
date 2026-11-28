// ほかの DAW とやり取りするための中間の形（トラックとクリップの一覧）と、Studio のプロジェクトからの変換（memo/daw-exchange.md）。形式ごとのファイル（rpp.ts など）はこの形だけを扱う
import { EQ_ID, encodeWav, findPlugin, migrateValues, type Clip } from 'wevocal-lib'
import type { XFx } from './rppFx'
import { builtinToReaper, type ReaperFxPrefer } from './reaperBuiltin'
import { reaperModeFor, simplify, type XEnvPoint } from './reaperPitch'
import { CURVE_HOP, pitchEnvAt } from '../project'
import { renderMix } from '../engine/render'
import { beatMap, blockBeats, type BeatMap } from '../beats'
import { playedNotes, playedPoints } from '../midiLoop'
import { ancestors, midiBlocks, type Block, type MidiBlock, type Project } from '../project'

/** MIDI の 4 分音符あたりの tick */
export const PPQ = 960

/** 加工した波形ブロックの渡し方。changed は加工のあるものだけ描画、all はすべて描画、original はすべて元の音（ピッチカーブなどは失う） */
export type ExchangeBlocks = 'changed' | 'all' | 'original'

export interface XClip {
  name: string
  /** 位置と長さ（秒） */
  start: number
  length: number
  /** 音声ファイル（files の名前） */
  file: string
  /** ファイルの中での開始位置（秒） */
  offset: number
  /** 音量（dB） */
  gain: number
  fadeIn: number
  fadeOut: number
  /** 速度（1 が元の速さ。ピッチは保つ） */
  rate: number
  /** ピッチ（半音） */
  pitch: number
  mute: boolean
  /** ピッチの処理方式（REAPER の番号。無ければ相手の既定） */
  pitchMode?: number
  /** ピッチのエンベロープ（アイテムの頭からの秒と半音。clip の pitch に足す） */
  pitchEnv?: XEnvPoint[]
  /** 音量のエンベロープ（アイテムの頭からの秒と dB） */
  volEnv?: XEnvPoint[]
}

/** MIDI のクリップ。events は頭からの tick と、チャンネル 1 のメッセージのバイト列（tick の順） */
export interface XMidi {
  name: string
  start: number
  length: number
  mute: boolean
  /** 長さ（tick） */
  ticks: number
  events: { tick: number; bytes: number[] }[]
}

export interface XTrack {
  name: string
  /** 音量（dB）、パン（-1〜1） */
  volume: number
  pan: number
  mute: boolean
  solo: boolean
  invert: boolean
  /** 親と子の深さ（0 が一番上） */
  depth: number
  clips: XClip[]
  midi: XMidi[]
  /** FX の列（書き出せるものだけ。target.fx のとき） */
  fx?: XFx[]
}

export interface XProject {
  bpm: number
  beatsPerBar: number
  markers: { time: number; name: string }[]
  /** 書き出せなかった FX の数（target.fx のとき） */
  skippedFx?: number
  /** 途中のテンポの変化（位置の順） */
  tempos: { time: number; bpm: number; beatsPerBar: number }[]
  master: { volume: number; pan: number; mute: boolean }
  tracks: XTrack[]
  /** 音声ファイル（名前 → WAV） */
  files: Map<string, Blob>
}

/** ピッチ、速度、フォルマント、曲線、エンベロープのどれかを変えたブロック（ゲインとフェードは各形式の項目で表せる） */
export const processed = (b: Block) => b.rate !== 1 || b.pitch !== 0 || b.formant !== 0 || !!b.curve || !!b.envelope?.length || !!b.pitchEnvelope?.length

/** ファイル名に使えない文字を除く */
const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'audio'

/** 重ならない名前を作る */
function uniqueName(used: Set<string>, base: string, ext: string) {
  let name = `${base}${ext}`
  for (let i = 2; used.has(name); i++) name = `${base} (${i})${ext}`
  used.add(name)
  return name
}

/** 1 つの波形ブロックだけを描画する（ブロックの加工、ゲイン、フェード、エンベロープまで。トラックの FX とフェーダーは含めない） */
async function renderBlock(p: Project, b: Block, sampleRate: number, signal?: AbortSignal): Promise<Clip> {
  const track = { ...p.tracks.find((t) => t.id === b.track)!, parent: undefined, volume: 0, pan: 0, invert: false, mute: false, solo: false, fx: [], sends: [], autoLane: undefined }
  const q: Project = { ...p, master: { volume: 0, pan: 0, mute: false }, tracks: [track], blocks: [{ ...b, start: 0, mute: false }], midi: [] }
  return renderMix(q, b.length, sampleRate, undefined, signal)
}

/** 親のすぐ後に子が続く順（フォルダーの形）に並べる。並びの中の順は今のまま */
export function treeOrder(p: Project): Project['tracks'] {
  const ids = new Set(p.tracks.map((t) => t.id))
  const out: Project['tracks'] = []
  const visit = (parent: string | undefined) => {
    for (const t of p.tracks) {
      const up = t.parent && ids.has(t.parent) ? t.parent : undefined
      if (up === parent && !out.includes(t)) {
        out.push(t)
        visit(t.id)
      }
    }
  }
  visit(undefined)
  return out
}

/** 曲線の直線の間を埋める間隔（拍）。MIDI の CC は段になるので、細かく刻む */
const CURVE_STEP = 1 / 16

/** MIDI ブロックを tick のイベントにする（ループを展開し、ミュートした音符は除く。曲線は直線の間を刻む） */
export function midiEvents(b: MidiBlock, map: BeatMap): XMidi {
  const len = blockBeats(map, b)
  const tick = (beat: number) => Math.max(0, Math.round(beat * PPQ))
  const events: { tick: number; bytes: number[]; order: number }[] = []
  for (const { note, t, dur } of playedNotes(b, len)) {
    if (note.mute) continue
    const vel = Math.max(1, Math.min(127, Math.round(note.vel * 127)))
    // 同じ tick では、離す（0）を押す（1）より先にする
    events.push({ tick: tick(t), bytes: [0x90, note.pitch, vel], order: 1 }, { tick: tick(t + dur), bytes: [0x80, note.pitch, 0], order: 0 })
  }
  for (const c of b.curves ?? []) {
    const pts = playedPoints(c.points, b.loop, len)
      .filter((q) => q.t < len)
      .sort((x, y) => x.t - y.t)
    const bytes = (v: number) => {
      if (c.kind === 'cc') return [0xb0, c.cc ?? 1, Math.max(0, Math.min(127, Math.round(v * 127)))]
      const x = Math.max(0, Math.min(16383, Math.round(((v + 1) / 2) * 16383)))
      return [0xe0, x & 0x7f, x >> 7]
    }
    pts.forEach((q, i) => {
      events.push({ tick: tick(q.t), bytes: bytes(q.v), order: 2 })
      const r = pts[i + 1]
      if (!r) return
      for (let t = q.t + CURVE_STEP; t < r.t - 1e-9; t += CURVE_STEP) events.push({ tick: tick(t), bytes: bytes(q.v + ((r.v - q.v) * (t - q.t)) / (r.t - q.t)), order: 2 })
    })
  }
  events.sort((x, y) => x.tick - y.tick || x.order - y.order)
  return { name: b.name || b.defaultName || 'MIDI', start: b.start, length: b.length, mute: b.mute, ticks: tick(len), events: events.map(({ tick, bytes }) => ({ tick, bytes })) }
}

/**
 * 波形ブロックのピッチカーブとピッチのエンベロープ、音量のエンベロープを、アイテムの頭からの秒の点にする。
 * ピッチカーブがあれば 10 ms ごとに読んで 0.05 半音以内に収まる点だけに減らし、なければエンベロープの点をそのまま（形も）移す
 */
export function blockEnvelopes(b: Block): { pitchEnv?: XEnvPoint[]; volEnv?: XEnvPoint[] } {
  const out: { pitchEnv?: XEnvPoint[]; volEnv?: XEnvPoint[] } = {}
  const toItem = (s: number) => (s - b.offset) / b.rate
  if (b.curve?.st.some((v) => v !== 0)) {
    const c = b.curve
    const pts: XEnvPoint[] = []
    for (let t = 0; t <= b.length + 1e-9; t += CURVE_HOP) {
      const s = b.offset + t * b.rate
      const i = Math.round((s - c.from) / CURVE_HOP)
      pts.push({ t, v: (i >= 0 && i < c.st.length ? c.st[i] : 0) + pitchEnvAt(b.pitchEnvelope, s) })
    }
    out.pitchEnv = simplify(pts, 0.05)
  } else if (b.pitchEnvelope?.length) out.pitchEnv = b.pitchEnvelope.map((p) => ({ t: toItem(p.s), v: p.st, ...(p.shape ? { shape: p.shape } : {}), ...(p.tension ? { tension: p.tension } : {}) }))
  if (b.envelope?.length) out.volEnv = b.envelope.map((p) => ({ t: p.t, v: p.db, ...(p.shape ? { shape: p.shape } : {}), ...(p.tension ? { tension: p.tension } : {}) }))
  return out
}

/** 書き出す形式でできること。clipGain はクリップに音量を書けるか（書けなければ、音量を変えたブロックも描画する） */
export interface ExchangeTarget {
  clipGain: boolean
  /** FX を書き出すか（VST と、REAPER の FX に変える組み込みの FX） */
  fx?: boolean
  /** 組み込みの FX の変換先の優先（Rea 系の VST か JSFX） */
  fxPrefer?: ReaperFxPrefer
}

/** トラックの FX の列を、書き出せる FX にする（VST はつまみの値のまま、組み込みの EQ は ReaEQ の帯に。ほかは数だけ返す） */
export function trackFx(t: Project['tracks'][number], bpm = 120, prefer: ReaperFxPrefer = 'vst'): { fx: XFx[]; skipped: number } {
  const fx: XFx[] = []
  let skipped = 0
  for (const s of t.fx ?? []) {
    const plugin = findPlugin(s.plugin)
    const m = plugin?.manifest
    // VST3 は REAPER の書き方（状態の形）が VST2 と違い、まだ書けない
    if (m?.format === 'vst' && /\.vst3$/i.test(m.vst?.file ?? '')) skipped++
    else if (m?.format === 'vst') {
      const values = migrateValues(m, s.values)
      const name = String(plugin?.lang?.en_us?.name ?? plugin?.lang?.ja_jp?.name ?? m.id)
      // 状態の塊（ほかの DAW から読んだもの）があれば、塊で書く
      const chunk = s.state ? Uint8Array.from(atob(s.state), (c) => c.charCodeAt(0)) : undefined
      fx.push({ kind: 'vst', on: s.on, name, file: m.vst?.file ?? `${name}.dll`, uniqueId: m.vst?.uniqueId ?? 0, params: m.params.map((d) => values[d.id] ?? d.default), ...(chunk ? { chunk } : {}) })
    } else {
      // 組み込みの FX は、REAPER の FX（Rea 系の VST か JSFX。prefer の方を先に）にする。平らな EQ は書かない
      const r = m ? builtinToReaper(s, migrateValues(m, s.values), bpm, prefer) : null
      if (r) fx.push(r)
      else if (s.plugin !== EQ_ID) skipped++
    }
  }
  return { fx, skipped }
}

/** Studio のプロジェクトを中間の形にする */
export async function toExchange(p: Project, mode: ExchangeBlocks, target: ExchangeTarget, onProgress?: (v: number) => void, signal?: AbortSignal): Promise<XProject> {
  const map = beatMap(p.tempo, p.markers)
  const files = new Map<string, Blob>()
  const used = new Set<string>()
  /** 元の音（source の id → ファイル名）。使うものだけを書く */
  const sourceFiles = new Map<string, string>()
  const sourceFile = (id: string) => {
    let name = sourceFiles.get(id)
    if (!name) {
      const s = p.sources.find((x) => x.id === id)!
      name = uniqueName(used, `audio/${safeName(s.name.replace(/\.[^.]+$/, ''))}`, '.wav')
      files.set(name, encodeWav(s.clip, 'pcm24'))
      sourceFiles.set(id, name)
    }
    return name
  }
  const sampleRate = 48000
  const total = Math.max(1, p.blocks.length)
  let done = 0
  let skippedFx = 0
  const tracks: XTrack[] = []
  for (const t of treeOrder(p)) {
    const clips: XClip[] = []
    for (const b of p.blocks.filter((x) => x.track === t.id).sort((x, y) => x.start - y.start)) {
      signal?.throwIfAborted()
      const source = p.sources.find((s) => s.id === b.source)
      const name = source?.name.replace(/\.[^.]+$/, '') ?? 'audio'
      const base = { name, start: b.start, length: b.length, mute: b.mute }
      if (source && (mode === 'original' || (mode === 'changed' && !processed(b) && (target.clipGain || b.gain === 0)))) {
        clips.push({ ...base, file: sourceFile(b.source), offset: b.offset, gain: b.gain, fadeIn: b.fadeIn, fadeOut: b.fadeOut, rate: b.rate, pitch: b.pitch, pitchMode: reaperModeFor(b.algorithm), ...blockEnvelopes(b) })
      } else if (source) {
        const clip = await renderBlock(p, b, sampleRate, signal)
        const file = uniqueName(used, `audio/${safeName(name)} ${safeName(t.name)}`, '.wav')
        files.set(file, encodeWav(clip, 'pcm24'))
        clips.push({ ...base, file, offset: 0, gain: 0, fadeIn: 0, fadeOut: 0, rate: 1, pitch: 0 })
      }
      onProgress?.(++done / total)
    }
    const midi = midiBlocks(p)
      .filter((x) => x.track === t.id)
      .sort((x, y) => x.start - y.start)
      .map((x) => midiEvents(x, map))
    const fx = target.fx ? trackFx(t, p.tempo.bpm, target.fxPrefer) : null
    skippedFx += fx?.skipped ?? 0
    tracks.push({ name: t.name, volume: t.volume, pan: t.pan, mute: t.mute, solo: t.solo, invert: !!t.invert, depth: ancestors(p, t).length, clips, midi, ...(fx ? { fx: fx.fx } : {}) })
  }
  const project: XProject = {
    bpm: p.tempo.bpm,
    beatsPerBar: p.tempo.beatsPerBar,
    markers: p.markers.map((m) => ({ time: m.time, name: m.name })),
    tempos: p.markers
      .filter((m) => m.tempo)
      .sort((x, y) => x.time - y.time)
      .map((m) => ({ time: m.time, ...m.tempo! })),
    master: { ...p.master },
    tracks,
    skippedFx,
    files,
  }
  return project
}

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
