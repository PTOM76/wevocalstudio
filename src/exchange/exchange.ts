// ほかの DAW とやり取りするための中間の形（トラックとクリップの一覧）と、Studio のプロジェクトからの変換（memo/daw-exchange.md）。形式ごとのファイル（rpp.ts など）はこの形だけを扱う
import { encodeWav, type Clip } from 'wevocal-lib'
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
}

export interface XProject {
  bpm: number
  beatsPerBar: number
  markers: { time: number; name: string }[]
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

/** Studio のプロジェクトを中間の形にする */
export async function toExchange(p: Project, mode: ExchangeBlocks, onProgress?: (v: number) => void, signal?: AbortSignal): Promise<XProject> {
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
  const tracks: XTrack[] = []
  for (const t of treeOrder(p)) {
    const clips: XClip[] = []
    for (const b of p.blocks.filter((x) => x.track === t.id).sort((x, y) => x.start - y.start)) {
      signal?.throwIfAborted()
      const source = p.sources.find((s) => s.id === b.source)
      const name = source?.name.replace(/\.[^.]+$/, '') ?? 'audio'
      const base = { name, start: b.start, length: b.length, mute: b.mute }
      if (source && (mode === 'original' || (mode === 'changed' && !processed(b)))) {
        clips.push({ ...base, file: sourceFile(b.source), offset: b.offset, gain: b.gain, fadeIn: b.fadeIn, fadeOut: b.fadeOut, rate: b.rate, pitch: b.pitch })
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
    tracks.push({ name: t.name, volume: t.volume, pan: t.pan, mute: t.mute, solo: t.solo, invert: !!t.invert, depth: ancestors(p, t).length, clips, midi })
  }
  const project: XProject = {
    bpm: p.tempo.bpm,
    beatsPerBar: p.tempo.beatsPerBar,
    markers: p.markers.map((m) => ({ time: m.time, name: m.name })),
    master: { ...p.master },
    tracks,
    files,
  }
  return project
}
