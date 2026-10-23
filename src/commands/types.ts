// コマンド（キーとメニューから行う操作）の型。ActionContext は App が渡すもの、CommandEnv は選択やコピーを加えた、表とメニューの共通の材料
import type { MidiBlock } from '../project'
import type { useT } from '../i18n'
import { type Block, type PitchEnvelopeRange, type Track, type VolumeEnvelopeRange } from '../project'
import { type EnvKind } from '../envelopes'
import type { useProject } from '../useProject'

export type ProjectApi = ReturnType<typeof useProject>

export interface ActionContext {
  doc: ProjectApi
  cursor: number
  playing: boolean
  defaultFade: number
  /** 貼り付けと無音の挿入のあと、再生位置を入れた範囲の終わりへ移すか（設定） */
  seekAfterInsert: boolean
  play: () => void
  /** 止めて、再生を始めた位置に戻る */
  stop: () => void
  /** その場で止める */
  pause: () => void
  repeat: boolean
  recording: boolean
  detectTempo: () => void
  toggleRecord: () => void
  toggleRepeat: () => void
  seek: (t: number) => void
  /** 編集カーソルだけを動かす（再生は止めない） */
  moveCursor: (t: number) => void
  /** 表示の拡大（factor > 1）と縮小 */
  zoom: (factor: number) => void
  /** from〜to 秒が画面に収まるように表示する */
  fit: (from: number, to: number) => void
  /** その位置から鳴らす */
  playAt: (t: number) => void
  /** 波形ブロックがある最後の位置 */
  end: number
  /** 線の 1 目盛り（秒。拍か秒） */
  gridStep: () => number
  newProject: () => void
  newWindow: () => void
  /** 最適化して保存するダイアログを開く */
  saveOptimized: () => void
  /** 動画の書き出し（追加機能「変換」） */
  exportVideo: () => void
  /** WeVocalSynth のプロジェクト（.wvsp）への書き出し（選んだトラック。なければ全トラック） */
  exportWvsp: () => void
  /** ボーカル抽出と楽器ごとの分離（波形ブロックの id） */
  /** ダイアログを開く（音を 0 から作る、MIDI の音符に並べる） */
  openDialog: (id: 'synth' | 'sampler' | 'renameTrack' | 'kanaCut' | 'marker' | 'markerTempo' | 'pianoRoll' | 'instrument' | 'midiProps' | 'tool' | 'analyze' | 'glidePitch' | 'vibrato', arg?: string | string[]) => void
  /** MIDI ファイルを選んで、トラックと MIDI ブロックにする */
  importMidi: () => void
  /** 選んだ MIDI ブロック（なければ全部）を MIDI ファイルに書き出す */
  exportMidi: (ids: string[]) => void
  /** 選んだ波形ブロックを確定する（音にして元の音を置き換える） */
  bake: (ids: string[]) => void
  extract: { vocals: (id: string) => void; lead: (id: string) => void; instruments: (id: string) => void; voices: (id: string, by: 'pitch' | 'volume') => void }
  /** 和音の分離をメニューに出すか（設定） */
  voiceSplit: boolean
  openProperties: (id: string) => void
  openFile: () => void
  importFiles: () => void
  /** その時刻とトラックへ音声ファイルを読み込む（トラックが無ければ空いているトラック） */
  importAt: (time: number, track: string | null) => void
  save: () => void
  /** 名前を付けて保存 */
  saveAs: () => void
  /** フォルダーへの保存（使えないブラウザでは null） */
  folder: { saveRange: () => void; saveBlocks: (ids: string[]) => void } | null
  /** 最近使用したファイル（PevenMUI の useRecentFiles） */
  recent: { supported: boolean; names: string[]; open: (i: number) => void; clear: () => void }
  openExport: () => void
  openSettings: () => void
  openHistory: () => void
  snap: boolean
  toggleSnap: () => void
  follow: boolean
  envelope: boolean
  toggleEnvelope: () => void
  /** ピッチのエンベロープを出して編集する */
  pitchEnvelope: boolean
  /** 表示しているエンベロープの種類（なければ null）と、道具がペンか（false なら選択） */
  envKind: EnvKind | null
  envPen: boolean
  setEnvPen: (pen: boolean) => void
  pitchEnvelopeRange: PitchEnvelopeRange
  envelopeRange: VolumeEnvelopeRange
  togglePitchEnvelope: () => void
  autoEdit: boolean
  toggleAutoEdit: () => void
  toggleFollow: () => void
  /** 線を拍と小節で取るか（でなければ秒） */
  beatGrid: boolean
  toggleGrid: () => void
  showAnalysis: boolean
  toggleAnalysis: () => void
  showMeters: boolean
  toggleMeters: () => void
  showMinimap: boolean
  toggleMinimap: () => void
  showStatusBar: boolean
  toggleStatusBar: () => void
  help: { guide: () => void; shortcuts: () => void; checkUpdate: () => void; licenses: () => void; about: () => void }
}

export interface Command {
  run: () => void
  /** 押せるか（省略なら押せる） */
  enabled?: boolean
}


/** コマンドの表とメニューが共通に使う、今の選択と、コピーと貼り付けなどの操作（useActions が毎回の描画で作る） */
export interface CommandEnv {
  c: ActionContext
  doc: ProjectApi
  t: ReturnType<typeof useT>
  /** 選んでいるトラック（複数のうち最後に選んだもの。貼り付けや録音の先）と、その選び方 */
  selectedTrack: string | null
  selectTrack: (id: string | null) => void
  /** 選んでいる MIDI ブロック、波形ブロックとその id */
  midiChosen: MidiBlock[]
  midiSel: MidiBlock | undefined
  chosen: Block[]
  ids: string[]
  /** 波形ブロックか MIDI ブロックを選んでいる、波形ブロックを選んでいる、選んだものがカーソルをまたいでいる */
  any: boolean
  anyWave: boolean
  canSplit: boolean
  /** 選んでいるトラックと、選んでいるブロックのトラック */
  track: Track | undefined
  blockTrack: Track | undefined
  /** 表示しているエンベロープに点がある、選んだ波形ブロック（初期化の対象） */
  envBlocks: Block[]
  resetEnvelope: (kind: EnvKind, ids: string[]) => void
  /** コピーしたもの（コピーしたら描き直す） */
  clipboard: { current: Block[] }
  midiClipboard: { current: MidiBlock[] }
  trackClipboard: { current: { track: Track; blocks: Block[] } | null }
  copied: () => void
  paste: (place?: { time: number; track: string | null }) => void
  duplicate: () => void
  nudge: (dir: 1 | -1) => void
}
