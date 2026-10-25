// プロジェクトの形（元の音声、トラック、波形ブロック）。音声は書き換えず、波形ブロックの値から再生と書き出しのたびに作る
import { type EnvPoint, type PitchPoint, type FadeShapes, type VolumeEnvelopeRange, type PitchEnvelopeRange } from './envelopeCurve'
export * from './envelopeCurve'
import { beatMap, type BeatMap } from './beats'
import { splitCurves } from './midiCurves'
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
  /** 音源（MIDI ブロックの音符を鳴らす。波形ブロックの音と一緒に、音量、FX の列、パンへ流れる） */
  instrument?: InstrumentSlot
  /** 古いプロジェクトのグラフィック EQ。読み込み時に fx の先頭へ読み替えて消す（fillTrack）。保存はしない */
  eq?: TrackEq
  /** 時間軸での縦の大きさ（px）。なければ既定値 */
  height?: number
  /** フリーズ。波形ブロックの音を書き出した元の音（source）と、その頭の時間軸の位置（秒）。あれば波形ブロックの代わりにこれを鳴らす（src/freeze.ts）。fx なら FX の列の先頭 fxCount 個も音に含めてあり、それは動かさない（後から足した FX は動かす。fxCount の無い古いものは全部） */
  frozen?: { source: string; start: number; fx?: boolean; fxCount?: number }
}

/** FX まで含めてフリーズしたときに音に含めた、FX の列の先頭の個数（変えられない） */
export function frozenFxCount(t: Track): number {
  return t.frozen?.fx ? Math.min(t.frozen.fxCount ?? Infinity, t.fx?.length ?? 0) : 0
}

/** トラックで実際に動かす FX の列（FX まで含めてフリーズしたトラックは、音に含めた分より後ろだけ） */
export function liveSlots(t: Track): FxSlot[] {
  return (t.fx ?? []).slice(frozenFxCount(t))
}

/** トラックの音源 */
export interface InstrumentSlot {
  /** 音源のプラグインの id（wevocal.synth など） */
  plugin: string
  values: Record<string, number>
  /** サンプラーの音色に使う元の音（source の id） */
  sample?: string
  /** サンプラーのフォルマント保持で使うピッチの処理方式（なければ wsola） */
  algorithm?: Algorithm
}

/**
 * ブロックの共通の形。時間軸に並べるものは、波形ブロック（Block）も MIDI ブロック（MidiBlock）も、
 * どのトラックの、いつから、どれだけの長さで、ミュートしているか、を持つ。動かす、長さを変える、選ぶ、消す、コピーするなどは、この形だけで扱える
 */
export interface BaseBlock {
  id: string
  track: string
  /** 既定名を上書きする表示名（空欄なら音源名などを使う） */
  name?: string
  /** 時間軸での開始位置（秒） */
  start: number
  /** 長さ（秒。時間軸の上での長さ） */
  length: number
  mute: boolean
}

/** どちらのブロックか */
export type AnyBlock = Block | MidiBlock
export const isMidiBlock = (b: AnyBlock): b is MidiBlock => 'notes' in b

/** 音符（MIDI ブロックの頭からの拍。4 分音符 = 1。秒への変換は beats.ts） */
export interface Note {
  /** 選択などで音符を指す。古いプロジェクトには無いので、読み込み時に付ける（fillMidi） */
  id: string
  /** 始まり（拍） */
  t: number
  /** 長さ（拍） */
  dur: number
  /** MIDI ノート番号（C4 = 60） */
  pitch: number
  /** 強さ 0〜1 */
  vel: number
  /** ミュート（鳴らさない） */
  mute?: boolean
}

/** 読み込んだ MIDI ブロックを今の形にする。unit の無い古いものは音符が秒なので拍へ直し、id の無い音符に id を付ける */
export function fillMidi(b: Omit<MidiBlock, 'unit'> & { unit?: 'beat' }, tempo: Tempo, markers: readonly Marker[]): MidiBlock {
  const map = b.unit === 'beat' ? null : beatMap(tempo, markers)
  const b0 = map ? map.toBeat(b.start) : 0
  const notes = b.notes.map((n) => {
    const id = n.id || newId()
    if (!map) return n.id ? n : { ...n, id }
    const t = map.toBeat(b.start + n.t) - b0
    return { ...n, id, t, dur: map.toBeat(b.start + n.t + n.dur) - b0 - t }
  })
  return { ...b, unit: 'beat', notes }
}

/** コントロールの曲線（CC かピッチベンド）。点（ブロックの頭からの拍と値）を直線でつなぐ。値は cc が 0〜1、ピッチベンドが -1〜1（±2 半音） */
export interface MidiCurve {
  kind: 'cc' | 'bend'
  /** CC の番号（ピッチベンドでは省く）。64 はサステイン、1 はモジュレーション、11 はエクスプレッション */
  cc?: number
  /** t の順に並べる */
  points: { t: number; v: number }[]
}

/** MIDI ブロック。音符を MIDI のまま持ち、トラックの音源で鳴らす */
export interface MidiBlock extends BaseBlock {
  /** MIDI ファイルから読み込んだときの既定表示名 */
  defaultName?: string
  /** 音符を拍で持つ印（無いものは古いプロジェクトで、秒。読み込み時に直す: fillMidi） */
  unit: 'beat'
  notes: Note[]
  /** コントロールの曲線（CC、ピッチベンド） */
  curves?: MidiCurve[]
  /** ループの長さ（拍）。あれば、頭からこの長さまでの中身を繰り返して、ブロックの終わりまで鳴らす（これより後ろの音符は鳴らさない） */
  loop?: number
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
export interface Block extends BaseBlock, FadeShapes {
  source: string
  /** 元の音の中での開始位置（秒） */
  offset: number
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
  /** 音量エンベロープの表示範囲（下限 dB。未指定なら設定の既定値） */
  envelopeRange?: VolumeEnvelopeRange
  /** ピッチのエンベロープ（半音。pitch とピッチカーブに足す）。元の音の時刻で持つ（ピッチカーブと同じく、分割や端の調整をしてもずれない） */
  pitchEnvelope?: PitchPoint[]
  /** ピッチエンベロープの表示範囲（半音。未指定なら設定の既定値） */
  pitchEnvelopeRange?: PitchEnvelopeRange
  /** 頭をなめらかにつないだ長さ（秒。時間軸の上で）。つなぎ直すとき、この区間の点を置き換える */
  glide?: number
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
  /** 行の高さ（なければ既定。トラックと同じ範囲） */
  height?: number
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
  /** MIDI ブロック（無ければなし。古いプロジェクトには無い） */
  midi?: MidiBlock[]
  /** 曲の終わり（秒）。無ければ自動（最後の波形ブロックの終わり＋FX の余韻） */
  end?: number
}

/** 新しいプロジェクト。すぐ置けるよう、空のトラックを 1 つ用意しておく */
export const newProject = (bpm = DEFAULT_TEMPO.bpm): Project => ({ sources: [], tempo: bpm === DEFAULT_TEMPO.bpm ? DEFAULT_TEMPO : { ...DEFAULT_TEMPO, bpm }, markers: [], master: { volume: 0, pan: 0, mute: false }, tracks: [newTrack(1)], blocks: [] })

/** 新しい波形ブロックの処理方式（設定の既定値） */
export type PitchDefaults = Pick<Block, 'algorithm' | 'preserveFormant'>

export const newId = () => crypto.randomUUID()

export const dbToGain = (db: number) => (db <= -60 ? 0 : 10 ** (db / 20))

export const newTrack = (n: number): Track => ({ id: newId(), name: `Track ${n}`, volume: 0, pan: 0, mute: false, solo: false })

export const TRACK_HEIGHT_MIN = 56
export const TRACK_HEIGHT_MAX = 220
export const TRACK_HEIGHT_DEFAULT = 96
export const trackHeight = (track: Track) => Math.max(TRACK_HEIGHT_MIN, Math.min(TRACK_HEIGHT_MAX, track.height ?? TRACK_HEIGHT_DEFAULT))

export const masterHeight = (master: Master) => Math.max(TRACK_HEIGHT_MIN, Math.min(TRACK_HEIGHT_MAX, master.height ?? TRACK_HEIGHT_DEFAULT))

export const newBlock = (track: string, source: Source, start: number, defaults: PitchDefaults, defaultFade = DEFAULT_FADE): Block => ({
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
  fadeIn: Math.min(defaultFade, source.duration / 2),
  fadeOut: Math.min(defaultFade, source.duration / 2),
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

/** MIDI ブロック（無いプロジェクトでは空） */
export const midiBlocks = (p: Project): MidiBlock[] => p.midi ?? []

/** 全部のブロック（波形ブロックと MIDI ブロック） */
export const allBlocks = (p: Project): AnyBlock[] => [...p.blocks, ...midiBlocks(p)]

/** 最後の波形ブロックの終わり（秒） */
export const projectEnd = (p: Project) => Math.max(p.blocks.reduce((m, b) => Math.max(m, b.start + b.length), 0), midiBlocks(p).reduce((m, b) => Math.max(m, b.start + b.length), 0))

/** 曲の終わり（秒）。決めていなければ、最後の波形ブロックの終わりに、全トラックとマスターの FX の余韻の最大を足す。書き出しの長さと「曲の終わりで止める」に使う */
export function songEnd(p: Project): number {
  if (p.end !== undefined) return p.end
  const last = projectEnd(p)
  if (!last) return 0
  return last + Math.max(chainTail(p.master.fx, p.tempo.bpm), ...p.tracks.map((t) => chainTail(t.fx, p.tempo.bpm)))
}

/** トラックの並びごとの、鳴らすトラックとそのトラック自身の音を鳴らすトラック（描画や波形ブロックごとに先祖と子孫をたどり直さない） */
const audibleCache = new WeakMap<Track[], { all: Set<string>; own: Set<string> }>()
function audibleSets(p: Project) {
  let out = audibleCache.get(p.tracks)
  if (out) return out
  const all = new Set<string>()
  const own = new Set<string>()
  const solo = p.tracks.some((t) => t.solo)
  // ソロのトラックの先祖（子の音を通すために鳴らす）
  const soloAncestors = new Set<string>()
  if (solo) for (const t of p.tracks) if (t.solo) for (const a of ancestors(p, t)) soloAncestors.add(a.id)
  for (const t of p.tracks) {
    const anc = ancestors(p, t)
    if (!solo) {
      if (!t.mute && !anc.some((a) => a.mute)) all.add(t.id), own.add(t.id)
    } else if (t.solo || anc.some((a) => a.solo)) {
      // 自分か先祖がソロなら鳴る
      all.add(t.id)
      own.add(t.id)
    } else if (soloAncestors.has(t.id)) all.add(t.id)
  }
  audibleCache.set(p.tracks, (out = { all, own }))
  return out
}

/** 鳴らすトラックか（ソロがあればソロだけ、なければミュート以外。子孫がソロなら、その音を通すために鳴らす） */
export const audible = (p: Project, track: Track) => audibleSets(p).all.has(track.id)

/** そのトラック自身の音（波形ブロック、音源）を鳴らすか。ソロのとき、子がソロなだけの親は自分の音は鳴らさず、子の音を通すだけ（audible は通すほう） */
export const ownAudible = (p: Project, track: Track) => audibleSets(p).own.has(track.id)

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

/** 音を書き出してあるトラック（フリーズしたトラックと、その子孫。波形ブロックと音符は鳴らさず、作り直さず、変えさせない） */
const bakedCache = new WeakMap<Track[], Set<string>>()
export function bakedTracks(p: Project): Set<string> {
  let out = bakedCache.get(p.tracks)
  if (!out) {
    out = new Set(p.tracks.filter((t) => t.frozen || ancestors(p, t).some((a) => a.frozen)).map((t) => t.id))
    bakedCache.set(p.tracks, out)
  }
  return out
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
/**
 * MIDI ブロックを時刻 t で 2 つに分ける。またぐ音符は、前の方では t で切り、後ろの方では頭から残りの長さで続ける。
 * t がブロックの中でなければ null
 */
export function splitMidiBlock(b: MidiBlock, t: number, map: BeatMap): [MidiBlock, MidiBlock] | null {
  const sec = t - b.start
  if (sec <= 0.001 || sec >= b.length - 0.001) return null
  const at = map.toBeat(t) - map.toBeat(b.start)
  const left = b.notes.filter((n) => n.t < at).map((n) => ({ ...n, dur: Math.min(n.dur, at - n.t) }))
  const right = b.notes
    .filter((n) => n.t + n.dur > at)
    .map((n) => ({ ...n, id: newId(), t: Math.max(0, n.t - at), dur: Math.min(n.dur, n.t + n.dur - at) }))
  const [lc, rc] = splitCurves(b.curves, at)
  const { curves: _, ...rest } = b
  return [
    { ...rest, length: sec, notes: left, ...(lc ? { curves: lc } : {}) },
    { ...rest, id: newId(), start: t, length: b.length - sec, notes: right, ...(rc ? { curves: rc } : {}) },
  ]
}

export function splitBlock(b: Block, t: number, defaultFade = DEFAULT_FADE): [Block, Block] | null {
  const at = t - b.start
  if (at <= 0.001 || at >= b.length - 0.001) return null
  // 切れ目の側のフェードは新しく付けるので、元の形状は持ち越さない
  const { fadeInShape, fadeInTension, fadeOutShape, fadeOutTension, ...rest } = b
  const keepIn = { ...(fadeInShape ? { fadeInShape } : {}), ...(fadeInTension ? { fadeInTension } : {}) }
  const keepOut = { ...(fadeOutShape ? { fadeOutShape } : {}), ...(fadeOutTension ? { fadeOutTension } : {}) }
  return [
    { ...rest, ...keepIn, length: at, fadeIn: Math.min(b.fadeIn, at), fadeOut: Math.min(defaultFade, at / 2) },
    { ...rest, ...keepOut, id: newId(), start: t, offset: b.offset + at * b.rate, length: b.length - at, fadeIn: Math.min(defaultFade, (b.length - at) / 2), fadeOut: Math.min(b.fadeOut, b.length - at) },
  ]
}

/** 音（作った音など）を、新しいトラックの波形ブロックとして位置 `start` に置く（トラックは一番下） */
export function addClipTrack(p: Project, clip: Clip, name: string, start: number, defaultFade = DEFAULT_FADE): Project {
  const source: Source = { id: newId(), name, clip, duration: clip.channels[0].length / clip.sampleRate }
  const track = { ...newTrack(0), name }
  return { ...p, sources: [...p.sources, source], tracks: [...p.tracks, track], blocks: [...p.blocks, fillBlock({ id: newId(), track: track.id, source: source.id, start, offset: 0, length: source.duration, fadeIn: Math.min(defaultFade, source.duration / 2), fadeOut: Math.min(defaultFade, source.duration / 2) })] }
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
