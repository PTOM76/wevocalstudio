// 波形ブロックの音を足すミキサー（AudioWorklet。音を出すスレッドで 128 サンプルずつ、今かかっている声だけを読んで足す）
import { FADE, mixInto, nextVoices, type ClipStore, type Live } from './mixCore'
import type { MixerMessage } from './types'

// AudioWorkletGlobalScope の型（TypeScript の標準の型にはない）
declare const sampleRate: number
declare const currentTime: number
declare class AudioWorkletProcessor {
  readonly port: MessagePort
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void

/** 音のデータの置き場（同じ AudioContext のミキサーで共通。id で 1 回だけ送られてくる） */
const clips: ClipStore = new Map()

class BlockMixer extends AudioWorkletProcessor {
  /** 声（始まりの順） */
  private live: Live[] = []
  /** 止めたとき（全部をフェードアウトして、終わったら処理をやめる） */
  private stoppedAt = 0

  constructor() {
    super()
    this.port.onmessage = (e: MessageEvent<MixerMessage>) => this.receive(e.data)
  }

  private receive(m: MixerMessage) {
    if (m.type === 'clip') clips.set(m.id, { sampleRate: m.sampleRate, channels: m.channels })
    else if (m.type === 'unclip') for (const id of m.ids) clips.delete(id)
    else if (m.type === 'voices') {
      this.live = nextVoices(this.live, m.voices, currentTime, m.smooth)
    } else if (m.type === 'stop') this.stoppedAt = currentTime
    else if (m.type === 'ping') this.port.postMessage({ type: 'pong', id: m.id })
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]) {
    const out = outputs[0]
    const L = out[0]
    const R = out[1] ?? out[0]
    const t0 = currentTime
    if (this.stoppedAt > 0 && t0 > this.stoppedAt + FADE) return false
    mixInto(this.live, clips, t0, sampleRate, L, R, this.stoppedAt)
    return true
  }
}

registerProcessor('block-mixer', BlockMixer)
