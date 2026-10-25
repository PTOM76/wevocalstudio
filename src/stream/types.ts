// 先を走る Worker（stream.worker.ts）と、読むだけのノード（stream.reader.worklet.ts）とのやり取りの形。時刻は曲のサンプル位置
import type { Voice } from '../mixer/types'
import type { StreamSlot } from './trackStream'

/** メイン → Worker */
export type StreamMessage =
  | { type: 'init'; sampleRate: number }
  | { type: 'source'; key: string; source: string }
  | { type: 'clip'; id: number; sampleRate: number; channels: Float32Array[] }
  | { type: 'unclip'; ids: number[] }
  /** トラックの今の値（初めてのときは、読むだけのノードへ送る port を付ける）。smooth なら、作ってある先を捨てて作り直す */
  | { type: 'track'; id: string; gain: number; slots: StreamSlot[]; voices: Voice[]; smooth: boolean; port?: MessagePort }
  | { type: 'remove'; id: string }
  /** 作り始める。pos を受け取るまでは位置を進めない（再生が始まる時刻はあとで決まる） */
  | { type: 'play'; frame: number }
  | { type: 'pos'; frame: number }
  | { type: 'stop' }

/** Worker → メイン */
export type StreamEvent = { type: 'failed'; id: string; error: string } | { type: 'ready' }

/** Worker → 読むだけのノード（Worker から直接） */
export type ReaderMessage = { type: 'block'; frame: number; L: Float32Array; R: Float32Array } | { type: 'drop'; from: number }

/** メイン → 読むだけのノード */
export type ReaderControl = { type: 'connect'; port: MessagePort; zero: number } | { type: 'zero'; zero: number } | { type: 'stop' }

/** 読むだけのノード → メイン */
export type ReaderEvent = { type: 'underrun'; frames: number }
