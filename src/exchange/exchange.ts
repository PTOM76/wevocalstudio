// ほかの DAW とやり取りするための中間の形（トラックとクリップの一覧）と、Studio のプロジェクトからの変換（memo/daw-exchange.md）。形式ごとのファイル（rpp.ts など）はこの形だけを扱う
import { encodeWav, type Clip } from 'wevocal-lib'
import { renderMix } from '../engine/render'
import { ancestors, type Block, type Project } from '../project'

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

/** Studio のプロジェクトを中間の形にする。MIDI ブロックはまだ渡さない（数を返す） */
export async function toExchange(p: Project, mode: ExchangeBlocks, onProgress?: (v: number) => void, signal?: AbortSignal): Promise<{ project: XProject; skippedMidi: number }> {
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
    tracks.push({ name: t.name, volume: t.volume, pan: t.pan, mute: t.mute, solo: t.solo, invert: !!t.invert, depth: ancestors(p, t).length, clips })
  }
  const project: XProject = {
    bpm: p.tempo.bpm,
    beatsPerBar: p.tempo.beatsPerBar,
    markers: p.markers.map((m) => ({ time: m.time, name: m.name })),
    master: { ...p.master },
    tracks,
    files,
  }
  return { project, skippedMidi: p.midi?.length ?? 0 }
}
