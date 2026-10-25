// ミキサー（AudioWorklet）とやり取りする形。時刻はすべて AudioContext の秒（currentTime と同じ時計）
import type { EnvShape } from '../envelopeCurve'

/** 声（波形ブロックの片 1 つ）。音量は level にフェード、つなぎ目、エンベロープを掛けたもの */
export interface Voice {
  /** 見分け（波形ブロックと片） */
  key: string
  /** 値を比べる文字（変わったら差し替える） */
  sig: string
  /** 鳴らす範囲 */
  t0: number
  t1: number
  /** 音のデータの id と、t0 に読む元の音の位置（サンプル） */
  clip: number
  f0: number
  /** 波形ブロックの範囲と、そのフェード（秒） */
  bt0: number
  bt1: number
  fadeIn: number
  fadeOut: number
  /** フェードの形状（なければ直線） */
  fadeInShape?: EnvShape
  fadeInTension?: number
  fadeOutShape?: EnvShape
  fadeOutTension?: number
  /** 片のつなぎ目のクロスフェード（秒。隣がなければ 0） */
  joinIn: number
  joinOut: number
  /** 音量（線形） */
  level: number
  /** 音量のエンベロープ（時刻と線形の音量を交互に並べたもの。なければ空） */
  env: number[]
}

export type MixerMessage =
  | { type: 'clip'; id: number; sampleRate: number; channels: Float32Array[] }
  | { type: 'unclip'; ids: number[] }
  /** 声の一覧（全部）。smooth なら、途中から足された声をフェードインする */
  | { type: 'voices'; voices: Voice[]; smooth: boolean }
  | { type: 'stop' }
  | { type: 'ping'; id: number }
