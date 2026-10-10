// プロジェクトの形（元の音声、トラック、波形ブロック）。音声は書き換えず、波形ブロックの値から再生と書き出しのたびに作る
import type { Algorithm, Clip, TrackEq } from 'wevocal-lib'

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
  /** 録音待機（REAPER の録音アーム）。録った音はこのトラックに置く */
  armed?: boolean
  /** 位相の反転（WeVocalSynth のフェーダーと同じ） */
  invert?: boolean
  /** 親のトラック（サブトラック。REAPER のフォルダートラック）。音は親を通ってからマスターへ行く。子は親のすぐ後ろに並べる */
  parent?: string
  /** 子のトラックをたたんで隠す */
  collapsed?: boolean
  /** グラフィック EQ（WeVocalSynth と同じ。無ければ平ら） */
  eq?: TrackEq
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
  /** フォルマントのずらし量（半音。WeVocalSynth の「フォルマント」と同じ。0 なら変えない） */
  formant: number
  /** ピッチカーブ（なければ一定のピッチ）。元の音の時刻 from 秒から 10ms ごとの半音（pitch に足す）。元の音の時刻で持つので、分割や端の調整をしてもずれない */
  curve?: PitchCurve
  /** 音量のエンベロープ（REAPER のアイテムの音量エンベロープ）。無ければ平ら。gain とフェードに重ねて掛ける */
  envelope?: EnvPoint[]
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

/** テンポ（WeVocalSynth の ProjectTempo と同じ形） */
export interface Tempo {
  bpm: number
  /** 1 小節の拍数 */
  beatsPerBar: number
  /** 1 拍目の位置（秒） */
  beatOffset: number
}
export const DEFAULT_TEMPO: Tempo = { bpm: 120, beatsPerBar: 4, beatOffset: 0 }

/** 位置に付ける名前付きの目印（WeVocalSynth の Marker と同じ形） */
export interface Marker {
  id: string
  /** 位置（秒） */
  time: number
  name: string
  /** ここからテンポを変える（WeVocalSynth と同じ。無ければ前のテンポが続く） */
  tempo?: { bpm: number; beatsPerBar: number }
}

/** エンベロープの点（波形ブロックの頭からの秒と dB。t の順に並べる） */
export interface EnvPoint {
  t: number
  db: number
}

/** エンベロープの範囲（dB） */
export const ENV_MIN = -60
export const ENV_MAX = 12

/** 波形ブロックの頭から t 秒のエンベロープの値（dB）。点の間は dB でまっすぐ、外は端の点の値 */
export function envAt(env: EnvPoint[] | undefined, t: number): number {
  if (!env?.length) return 0
  if (t <= env[0].t) return env[0].db
  for (let i = 1; i < env.length; i++) {
    const a = env[i - 1]
    const b = env[i]
    if (t <= b.t) return b.t === a.t ? b.db : a.db + ((b.db - a.db) * (t - a.t)) / (b.t - a.t)
  }
  return env[env.length - 1].db
}

/** ピッチカーブ（元の音の時刻 from 秒から CURVE_HOP 秒ごとの半音） */
export interface PitchCurve {
  from: number
  st: number[]
}
/** ピッチカーブの間隔（秒。Analyzer の F0 と同じ 10ms） */
export const CURVE_HOP = 0.01

export interface Project {
  sources: Source[]
  tempo: Tempo
  markers: Marker[]
  master: Master
  tracks: Track[]
  blocks: Block[]
}

/** 新しいプロジェクト。すぐ置けるよう、空のトラックを 1 つ用意しておく */
export const newProject = (): Project => ({ sources: [], tempo: DEFAULT_TEMPO, markers: [], master: { volume: 0, pan: 0, mute: false }, tracks: [newTrack(1)], blocks: [] })

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
  formant: 0,
  ...defaults,
  fadeIn: Math.min(DEFAULT_FADE, source.duration / 2),
  fadeOut: Math.min(DEFAULT_FADE, source.duration / 2),
  mute: false,
})

/** 新しい波形ブロックと、分割した切れ目に付けるフェード（秒。REAPER の既定と同じ 10ms。切れ目のプツッという音を防ぐ） */
export const DEFAULT_FADE = 0.01

/** 速度の範囲（REAPER と同じく 1/4 倍から 4 倍） */
export const RATE_MIN = 0.25
export const RATE_MAX = 4

/** 古いファイルの波形ブロックに無い項目を既定値で埋める（保存したデータは壊さない） */
export const fillBlock = (b: Partial<Block> & Pick<Block, 'id'>): Block => ({ rate: 1, gain: 0, pitch: 0, formant: 0, algorithm: 'sola3', preserveFormant: true, fadeIn: 0, fadeOut: 0, mute: false, ...b }) as Block

/** 元の音を越えないように、長さ、開始位置、フェードをそろえる */
export function fitBlock(b: Block, duration: number): Block {
  const rate = Math.max(RATE_MIN, Math.min(RATE_MAX, b.rate))
  const offset = Math.min(Math.max(0, b.offset), Math.max(0, duration - 0.01))
  const length = Math.max(0.01, Math.min(b.length, (duration - offset) / rate))
  const fadeIn = Math.min(b.fadeIn, length)
  return { ...b, rate, offset, length, fadeIn, fadeOut: Math.min(b.fadeOut, length - fadeIn) }
}

/** 全体の長さ（秒） */
export const projectEnd = (p: Project) => p.blocks.reduce((m, b) => Math.max(m, b.start + b.length), 0)

/** 鳴らすトラックか（ソロがあればソロだけ、なければミュート以外） */
export function audible(p: Project, track: Track) {
  if (!p.tracks.some((t) => t.solo)) return !track.mute
  // ソロのとき: 自分か先祖がソロなら鳴る。子孫がソロなら、その音を通すために鳴らす（REAPER と同じ）
  return track.solo || ancestors(p, track).some((t) => t.solo) || descendants(p, track).some((t) => t.solo)
}

/** 親から先祖をたどる（近い順） */
export function ancestors(p: Project, track: Track): Track[] {
  const out: Track[] = []
  for (let t = p.tracks.find((x) => x.id === track.parent); t && out.length < 64; t = p.tracks.find((x) => x.id === t!.parent)) out.push(t)
  return out
}

/** 子孫（並びの順） */
export function descendants(p: Project, track: Track): Track[] {
  return p.tracks.filter((t) => ancestors(p, t).some((a) => a.id === track.id))
}

/** 階層の深さ（0 が一番上） */
export const depthOf = (p: Project, track: Track) => ancestors(p, track).length

/** 見えているトラック（たたんだ親の子孫は隠す） */
export const visibleTracks = (p: Project) => p.tracks.filter((t) => !ancestors(p, t).some((a) => a.collapsed))

/** トラックとその子孫の、並びの上での終わり（次の index） */
export function subtreeEnd(p: Project, index: number) {
  const id = p.tracks[index].id
  let i = index + 1
  while (i < p.tracks.length && ancestors(p, p.tracks[i]).some((a) => a.id === id)) i++
  return i
}

/** 位置 t で波形ブロックを 2 つに分ける（REAPER の S） */
export function splitBlock(b: Block, t: number): [Block, Block] | null {
  const at = t - b.start
  if (at <= 0.001 || at >= b.length - 0.001) return null
  return [
    { ...b, length: at, fadeIn: Math.min(b.fadeIn, at), fadeOut: Math.min(DEFAULT_FADE, at / 2) },
    { ...b, id: newId(), start: t, offset: b.offset + at * b.rate, length: b.length - at, fadeIn: Math.min(DEFAULT_FADE, (b.length - at) / 2), fadeOut: Math.min(b.fadeOut, b.length - at) },
  ]
}
