// プロジェクトの形（元の音声、トラック、波形ブロック）。音声は書き換えず、波形ブロックの値から再生と書き出しのたびに作る
import type { Clip } from 'wevocal-lib'

/** 読み込んだ音声ファイル（元の音）。波形ブロックはこれを参照するだけで、中身を書き換えない */
export interface Source {
  id: string
  name: string
  clip: Clip
  /** 長さ（秒） */
  duration: number
}

/** トラック（REAPER のトラック）。波形ブロックを時間軸に並べる */
export interface Track {
  id: string
  name: string
  /** 音量（dB） */
  volume: number
  /** パン（-1〜1） */
  pan: number
  mute: boolean
  solo: boolean
}

/** 波形ブロック（REAPER のアイテム）。元の音のどこを、いつ、どう鳴らすか */
export interface Block {
  id: string
  track: string
  source: string
  /** 時間軸での開始位置（秒） */
  start: number
  /** 元の音の中での開始位置（秒） */
  offset: number
  /** 長さ（秒） */
  length: number
  /** 音量（dB） */
  gain: number
  /** ピッチ（半音）。元の音から変える（dsp/pitch.ts） */
  pitch: number
  /** フェードイン、フェードアウト（秒） */
  fadeIn: number
  fadeOut: number
  mute: boolean
}

export interface Project {
  sources: Source[]
  tracks: Track[]
  blocks: Block[]
}

export const EMPTY_PROJECT: Project = { sources: [], tracks: [], blocks: [] }

export const newId = () => crypto.randomUUID()

export const dbToGain = (db: number) => (db <= -60 ? 0 : 10 ** (db / 20))

export const newTrack = (n: number): Track => ({ id: newId(), name: `Track ${n}`, volume: 0, pan: 0, mute: false, solo: false })

export const newBlock = (track: string, source: Source, start: number): Block => ({
  id: newId(),
  track,
  source: source.id,
  start,
  offset: 0,
  length: source.duration,
  gain: 0,
  pitch: 0,
  fadeIn: 0,
  fadeOut: 0,
  mute: false,
})

/** 全体の長さ（秒） */
export const projectEnd = (p: Project) => p.blocks.reduce((m, b) => Math.max(m, b.start + b.length), 0)

/** 鳴らすトラックか（ソロがあればソロだけ、なければミュート以外） */
export function audible(p: Project, track: Track) {
  return p.tracks.some((t) => t.solo) ? track.solo : !track.mute
}

/** 位置 t で波形ブロックを 2 つに分ける（REAPER の S） */
export function splitBlock(b: Block, t: number): [Block, Block] | null {
  const at = t - b.start
  if (at <= 0.001 || at >= b.length - 0.001) return null
  return [
    { ...b, length: at, fadeOut: 0 },
    { ...b, id: newId(), start: t, offset: b.offset + at, length: b.length - at, fadeIn: 0 },
  ]
}
