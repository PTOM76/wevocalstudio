// プロジェクトの形（元の音声、トラック、波形ブロック）。音声は書き換えず、波形ブロックの値から再生と書き出しのたびに作る
import { chainTail, eqToSlot, missingPlugins, whenPluginsLoaded, isFlatEq, type Algorithm, type Clip, type FxSlot, type TrackEq } from 'wevocal-lib'

/** 読み込んだ音声ファイル（元の音）。波形ブロックはこれを参照するだけで、中身を書き換えない */
export interface Source {
  id: string
  name: string
  clip: Clip
  /** 長さ（秒） */
  duration: number
}

/** トラック。波形ブロックを時間軸に並べる */
export interface Track {
  id: string
  name: string
  /** 音量（dB） */
  volume: number
  /** パン（-1〜1） */
  pan: number
  mute: boolean
  solo: boolean
  /** 録音待機。録った音はこのトラックに置く */
  armed?: boolean
  /** 位相の反転（WeVocalSynth のフェーダーと同じ） */
  invert?: boolean
  /** 親のトラック（サブトラック）。音は親を通ってからマスターへ行く。子は親のすぐ後ろに並べる */
  parent?: string
  /** 子のトラックをたたんで隠す */
  collapsed?: boolean
  /** FX の列（WeVocal プラグイン。上から順に掛ける。無ければ何も掛けない） */
  fx?: FxSlot[]
  /** センド（フェーダーのあとの音を、ほかのトラックの入口へ送る） */
  sends?: Send[]
  /** 時間軸に出しているオートメーション（FX の何番目の項目の、どのつまみか）。編集するときにだけ使う表示の状態 */
  autoLane?: AutoLane
  /** 古いプロジェクトのグラフィック EQ。読み込み時に fx の先頭へ読み替えて消す（fillTrack）。保存はしない */
  eq?: TrackEq
  /** 時間軸での縦の大きさ（px）。なければ既定値 */
  height?: number
  /** フリーズ。波形ブロックの音を書き出した元の音（source）と、その頭の時間軸の位置（秒）。あれば波形ブロックの代わりにこれを鳴らす（src/freeze.ts） */
  frozen?: { source: string; start: number }
}

/** 時間軸に出しているオートメーション */
export interface AutoLane {
  slot: number
  param: string
}

/** センド 1 本: 送り先のトラックと、送る量（dB。SEND_MIN は送らない） */
export interface Send {
  to: string
  db: number
}
/** センドの下限（dB）。ここまで下げると送らない */
export const SEND_MIN = -60

/** 波形ブロック。元の音のどこを、いつ、どう鳴らすか */
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
  /** 速度（1 が元の速さ、2 で倍の速さ）。ピッチは変えずに長さが変わる。元の音の上では length × rate 秒を使う */
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
  /** 音量のエンベロープ。無ければ平ら。gain とフェードに重ねて掛ける */
  envelope?: EnvPoint[]
  /** ピッチのエンベロープ（半音。pitch とピッチカーブに足す）。元の音の時刻で持つ（ピッチカーブと同じく、分割や端の調整をしてもずれない） */
  pitchEnvelope?: PitchPoint[]
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
  /** FX の列（マスターに掛ける） */
  fx?: FxSlot[]
  autoLane?: AutoLane
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

/** ピッチのエンベロープの点（元の音の時刻 s 秒と半音。s の順に並べる） */
export interface PitchPoint {
  s: number
  st: number
}

/** ピッチのエンベロープの範囲（半音。上下とも） */
export const PITCH_ENV_MAX = 12

/** 元の音の時刻 s 秒のピッチのエンベロープの値（半音）。点の間はまっすぐ、外は端の点の値 */
export function pitchEnvAt(env: PitchPoint[] | undefined, s: number): number {
  if (!env?.length) return 0
  if (s <= env[0].s) return env[0].st
  for (let i = 1; i < env.length; i++) {
    const a = env[i - 1]
    const b = env[i]
    if (s <= b.s) return b.s === a.s ? b.st : a.st + ((b.st - a.st) * (s - a.s)) / (b.s - a.s)
  }
  return env[env.length - 1].st
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
  /** 曲の終わり（秒）。無ければ自動（最後の波形ブロックの終わり＋FX の余韻） */
  end?: number
}

/** 新しいプロジェクト。すぐ置けるよう、空のトラックを 1 つ用意しておく */
export const newProject = (): Project => ({ sources: [], tempo: DEFAULT_TEMPO, markers: [], master: { volume: 0, pan: 0, mute: false }, tracks: [newTrack(1)], blocks: [] })

/** 新しい波形ブロックの処理方式（設定の既定値） */
export type PitchDefaults = Pick<Block, 'algorithm' | 'preserveFormant'>

export const newId = () => crypto.randomUUID()

export const dbToGain = (db: number) => (db <= -60 ? 0 : 10 ** (db / 20))

export const newTrack = (n: number): Track => ({ id: newId(), name: `Track ${n}`, volume: 0, pan: 0, mute: false, solo: false })

export const TRACK_HEIGHT_MIN = 56
export const TRACK_HEIGHT_MAX = 220
export const TRACK_HEIGHT_DEFAULT = 96
export const trackHeight = (track: Track) => Math.max(TRACK_HEIGHT_MIN, Math.min(TRACK_HEIGHT_MAX, track.height ?? TRACK_HEIGHT_DEFAULT))

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

/** 新しい波形ブロックと、分割した切れ目に付けるフェード（秒） */
export const DEFAULT_FADE = 0.01

/** 速度の範囲（1/4 倍から 4 倍） */
export const RATE_MIN = 0.25
export const RATE_MAX = 4

/** プロパティで数値にできる項目の範囲（下限、上限）。プロパティの欄と、混在の欄への足し引きで共通 */
export const BLOCK_LIMITS = {
  start: [0, Infinity],
  length: [0.01, Infinity],
  offset: [0, Infinity],
  rate: [RATE_MIN, RATE_MAX],
  gain: [-60, 24],
  pitch: [-256, 256],
  formant: [-12, 12],
  fadeIn: [0, Infinity],
  fadeOut: [0, Infinity],
} as const satisfies Record<string, readonly [number, number]>

/** 古いファイルのトラックの eq を、FX の列の先頭の EQ に読み替える（保存したデータは壊さない）。平らな EQ は捨てる */
export function fillTrack(t: Track): Track {
  const { eq, ...rest } = t
  if (!eq) return t
  return rest.fx ? rest : { ...rest, fx: isFlatEq(eq) ? [] : [eqToSlot(eq)] }
}

/** プロジェクトの FX の列にある、入っていないプラグインの id（導入済みの読み込みが終わってから調べる） */
export async function missingFx(p: Project): Promise<string[]> {
  await whenPluginsLoaded()
  return missingPlugins(p.master.fx, ...p.tracks.map((t) => t.fx))
}

/** 古いファイルの波形ブロックに無い項目を既定値で埋める（保存したデータは壊さない） */
export const fillBlock = (b: Partial<Block> & Pick<Block, 'id'>): Block => ({ rate: 1, gain: 0, pitch: 0, formant: 0, algorithm: 'sola3', preserveFormant: true, fadeIn: 0, fadeOut: 0, mute: false, ...b }) as Block

/** 元の音の中に開始位置を収め、長さとフェードをそろえる（長さは元の音の終わりより先でもよい。足りない所は無音） */
export function fitBlock(b: Block, duration: number): Block {
  const rate = Math.max(RATE_MIN, Math.min(RATE_MAX, b.rate))
  const offset = Math.min(Math.max(0, b.offset), Math.max(0, duration - 0.01))
  const length = Math.max(0.01, b.length)
  const fadeIn = Math.min(b.fadeIn, length)
  return { ...b, rate, offset, length, fadeIn, fadeOut: Math.min(b.fadeOut, length - fadeIn) }
}

/** from から音が流れていく先（親、サイドチェーンで聞くトラック、センドの送り先）をたどって、to に着くか */
export function flowsTo(p: Project, from: string, to: string): boolean {
  const seen = new Set<string>()
  const stack = [from]
  while (stack.length) {
    const id = stack.pop()!
    if (id === to) return true
    if (seen.has(id)) continue
    seen.add(id)
    const t = p.tracks.find((x) => x.id === id)
    if (t?.parent) stack.push(t.parent)
    for (const s of t?.sends ?? []) stack.push(s.to)
    for (const x of p.tracks) if (x.fx?.some((s) => s.sidechain === id)) stack.push(x.id)
  }
  return false
}

/** track から送れるトラック（送ると音が輪になるものと、自分は除く） */
export const sendTargets = (p: Project, track: string): Track[] => p.tracks.filter((x) => x.id !== track && !flowsTo(p, x.id, track))

/** 最後の波形ブロックの終わり（秒） */
export const projectEnd = (p: Project) => p.blocks.reduce((m, b) => Math.max(m, b.start + b.length), 0)

/** 曲の終わり（秒）。決めていなければ、最後の波形ブロックの終わりに、全トラックとマスターの FX の余韻の最大を足す。書き出しの長さと「曲の終わりで止める」に使う */
export function songEnd(p: Project): number {
  if (p.end !== undefined) return p.end
  const last = projectEnd(p)
  if (!last) return 0
  return last + Math.max(chainTail(p.master.fx, p.tempo.bpm), ...p.tracks.map((t) => chainTail(t.fx, p.tempo.bpm)))
}

/** 鳴らすトラックか（ソロがあればソロだけ、なければミュート以外） */
export function audible(p: Project, track: Track) {
  if (!p.tracks.some((t) => t.solo)) return !track.mute && !ancestors(p, track).some((t) => t.mute)
  // ソロのとき: 自分か先祖がソロなら鳴る。子孫がソロなら、その音を通すために鳴らす
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

/** 位置 t で波形ブロックを 2 つに分ける */
export function splitBlock(b: Block, t: number): [Block, Block] | null {
  const at = t - b.start
  if (at <= 0.001 || at >= b.length - 0.001) return null
  return [
    { ...b, length: at, fadeIn: Math.min(b.fadeIn, at), fadeOut: Math.min(DEFAULT_FADE, at / 2) },
    { ...b, id: newId(), start: t, offset: b.offset + at * b.rate, length: b.length - at, fadeIn: Math.min(DEFAULT_FADE, (b.length - at) / 2), fadeOut: Math.min(b.fadeOut, b.length - at) },
  ]
}

/** 音（作った音など）を、新しいトラックの波形ブロックとして位置 `start` に置く（トラックは一番下） */
export function addClipTrack(p: Project, clip: Clip, name: string, start: number): Project {
  const source: Source = { id: newId(), name, clip, duration: clip.channels[0].length / clip.sampleRate }
  const track = { ...newTrack(0), name }
  return { ...p, sources: [...p.sources, source], tracks: [...p.tracks, track], blocks: [...p.blocks, fillBlock({ id: newId(), track: track.id, source: source.id, start, offset: 0, length: source.duration })] }
}

/** WeVocalSynth のプロジェクト（.wvsp）のトラックを取り込む。名前を付けた親トラックを作り、各トラックの加工後の音を波形ブロックとしてサブトラックに置く */
export function addWvspTracks(p: Project, name: string, tracks: { name: string; clip: Clip }[], start: number): Project {
  const parent = { ...newTrack(0), name }
  const out = { ...p, tracks: [...p.tracks, parent], sources: [...p.sources], blocks: [...p.blocks] }
  for (const t of tracks) {
    const source: Source = { id: newId(), name: t.name, clip: t.clip, duration: t.clip.channels[0].length / t.clip.sampleRate }
    const track = { ...newTrack(0), name: t.name, parent: parent.id }
    out.sources.push(source)
    out.tracks.push(track)
    out.blocks.push(fillBlock({ id: newId(), track: track.id, source: source.id, start, offset: 0, length: source.duration }))
  }
  return out
}
