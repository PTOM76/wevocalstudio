// プロジェクトの形（元の音声、トラック、波形ブロック）。音声は書き換えず、波形ブロックの値から再生と書き出しのたびに作る
import type { Algorithm, Clip } from 'wevocal-lib'

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
  /** 長さ（秒。時間軸の上での長さ） */
  length: number
  /** 速度（1 が元の速さ、2 で倍の速さ）。ピッチは変えずに長さが変わる（REAPER のアイテムの再生速度）。元の音の上では length × rate 秒を使う */
  rate: number
  /** 音量（dB） */
  gain: number
  /** ピッチ（半音。小数も使える）。元の音から変える（dsp/pitch.ts） */
  pitch: number
  /** ピッチを変える処理方式（WeVocalSynth と同じ） */
  algorithm: Algorithm
  /** ピッチを変えるときにフォルマント（声の響き）を保つ */
  preserveFormant: boolean
  /** フェードイン、フェードアウト（秒） */
  fadeIn: number
  fadeOut: number
  mute: boolean
}

/** マスタートラック。全トラックを混ぜたあとに掛ける */
export interface Master {
  /** 音量（dB） */
  volume: number
  /** パン（-1〜1） */
  pan: number
  mute: boolean
}

export interface Project {
  sources: Source[]
  master: Master
  tracks: Track[]
  blocks: Block[]
}

/** 新しいプロジェクト。すぐ置けるよう、空のトラックを 1 つ用意しておく */
export const newProject = (): Project => ({ sources: [], master: { volume: 0, pan: 0, mute: false }, tracks: [newTrack(1)], blocks: [] })

/** 新しい波形ブロックの処理方式（設定の既定値） */
export type PitchDefaults = Pick<Block, 'algorithm' | 'preserveFormant'>

export const newId = () => crypto.randomUUID()

export const dbToGain = (db: number) => (db <= -60 ? 0 : 10 ** (db / 20))

export const newTrack = (n: number): Track => ({ id: newId(), name: `Track ${n}`, volume: 0, pan: 0, mute: false, solo: false })

export const newBlock = (track: string, source: Source, start: number, defaults: PitchDefaults): Block => ({
  id: newId(),
  track,
  source: source.id,
  start,
  offset: 0,
  length: source.duration,
  rate: 1,
  gain: 0,
  pitch: 0,
  ...defaults,
  fadeIn: 0,
  fadeOut: 0,
  mute: false,
})

/** 速度の範囲（REAPER と同じく 1/4 倍から 4 倍） */
export const RATE_MIN = 0.25
export const RATE_MAX = 4

/** 古いファイルの波形ブロックに無い項目を既定値で埋める（保存したデータは壊さない） */
export const fillBlock = (b: Partial<Block> & Pick<Block, 'id'>): Block => ({ rate: 1, gain: 0, pitch: 0, algorithm: 'sola3', preserveFormant: true, fadeIn: 0, fadeOut: 0, mute: false, ...b }) as Block

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
    { ...b, id: newId(), start: t, offset: b.offset + at * b.rate, length: b.length - at, fadeIn: 0 },
  ]
}
