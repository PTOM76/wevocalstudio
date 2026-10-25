// 先を走る Worker（stream.worker.ts）と、読むだけのノード（stream.reader.worklet.ts）とのやり取りの形。時刻は曲のサンプル位置
import type { Voice } from '../mixer/types'
import type { StreamSlot } from './trackStream'

/** メイン → Worker */
export type StreamMessage =
  | { type: 'init'; sampleRate: number }
  /** プラグインごとに 1 回だけ送るもの（processor のソースと、processor に渡す大きいもの: wasm、VST の dll と写し） */
  | { type: 'source'; key: string; source: string; assets: Record<string, unknown> }
  | { type: 'clip'; id: number; sampleRate: number; channels: Float32Array[] }
  | { type: 'unclip'; ids: number[] }
  /**
   * トラックの今の値（初めてのときは、読むだけのノードへ送る port を付ける）。smooth は途中から始まる声をフェードインする、
   * rewind は作ってある先を捨てて作り直す（プラグインの状態だけが変わったときは作り直さない）。preroll は始める前に流す長さ（秒。余韻の長さ）
   */
  | { type: 'track'; id: string; gain: number; slots: StreamSlot[]; voices: Voice[]; smooth: boolean; rewind: boolean; preroll: number; port?: MessagePort }
  | { type: 'remove'; id: string }
  /** 作り始める。pos を受け取るまでは位置を進めない（再生が始まる時刻はあとで決まる） */
  | { type: 'play'; frame: number }
  | { type: 'pos'; frame: number }
  | { type: 'stop' }

/** Worker → メイン */
export type StreamEvent = { type: 'failed'; id: string; error: string } | { type: 'ready'; id: string } | { type: 'state'; id: string; index: number; state: string }

/** Worker → 読むだけのノード（Worker から直接） */
export type ReaderMessage = { type: 'block'; frame: number; L: Float32Array; R: Float32Array } | { type: 'drop'; from: number }

/** メイン → 読むだけのノード */
export type ReaderControl = { type: 'connect'; port: MessagePort; zero: number } | { type: 'zero'; zero: number } | { type: 'stop' }

/** 読むだけのノード → メイン */
export type ReaderEvent = { type: 'underrun'; frames: number }
