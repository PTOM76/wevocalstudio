// 読むだけのノード（AudioWorklet）。先を走る Worker が作った音を、曲の今の位置の所だけ出す。足りなければ無音にして、メインに知らせる
import type { ReaderControl, ReaderEvent, ReaderMessage } from './types'

// AudioWorkletGlobalScope の型（TypeScript の標準の型にはない）
declare const sampleRate: number
declare const currentTime: number
declare class AudioWorkletProcessor {
  readonly port: MessagePort
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void

/** 足りなかったことを知らせる間隔（秒） */
const REPORT = 0.25

class StreamReader extends AudioWorkletProcessor {
  /** 届いた音（始まりの順） */
  private blocks: { frame: number; L: Float32Array; R: Float32Array }[] = []
  /** 曲の位置 0 にあたる ctx の時刻 */
  private zero = 0
  private missing = 0
  private reportedAt = 0
  /** 外したら処理をやめる */
  private stopped = false

  constructor() {
    super()
    this.port.onmessage = (e: MessageEvent<ReaderControl>) => {
      const m = e.data
      if (m.type === 'stop') {
        this.stopped = true
        return
      }
      this.zero = m.zero
      if (m.type === 'connect') m.port.onmessage = (ev: MessageEvent<ReaderMessage>) => this.receive(ev.data)
    }
  }

  private receive(m: ReaderMessage) {
    if (m.type === 'drop') this.blocks = this.blocks.filter((b) => b.frame < m.from)
    else {
      // 作り直した分は、同じ位置の古いものを置き換える
      this.blocks = this.blocks.filter((b) => b.frame + b.L.length <= m.frame || b.frame >= m.frame + m.L.length)
      this.blocks.push({ frame: m.frame, L: m.L, R: m.R })
      this.blocks.sort((a, b) => a.frame - b.frame)
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]) {
    if (this.stopped) return false
    const out = outputs[0]
    const L = out[0]
    const R = out[1] ?? out[0]
    const n = L.length
    const start = Math.round((currentTime - this.zero) * sampleRate)
    // 過ぎたものは捨てる
    while (this.blocks.length && this.blocks[0].frame + this.blocks[0].L.length <= start) this.blocks.shift()
    if (start + n <= 0) return true
    let got = 0
    for (const b of this.blocks) {
      if (b.frame >= start + n) break
      const a = Math.max(start, b.frame)
      const z = Math.min(start + n, b.frame + b.L.length)
      for (let f = a; f < z; f++) {
        L[f - start] = b.L[f - b.frame]
        R[f - start] = b.R[f - b.frame]
      }
      got += z - a
    }
    const lack = n - Math.min(n, got + Math.max(0, -start))
    if (lack > 0) {
      this.missing += lack
      if (currentTime - this.reportedAt > REPORT) {
        this.reportedAt = currentTime
        this.port.postMessage({ type: 'underrun', frames: this.missing } satisfies ReaderEvent)
        this.missing = 0
      }
    }
    return true
  }
}

registerProcessor('stream-reader', StreamReader)
