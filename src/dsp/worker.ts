// wasm のピッチ変更を画面のスレッドの外で行う Worker
import wasmUrl from './dsp.wasm?url'

interface DspExports {
  memory: WebAssembly.Memory
  alloc_f32(len: number): number
  free_f32(ptr: number, len: number): void
  process_planar(input: number, frames: number, channels: number, sampleRate: number, semitones: number, stretch: number, algorithm: number, preserveFormant: number, formantSemitones: number): number
  output_ptr(): number
}

export interface PitchRequest {
  id: number
  channels: Float32Array[]
  sampleRate: number
  semitones: number
  /** 長さの倍率（速度の逆数） */
  stretch: number
  /** wevocal-lib の ALGORITHM_ID の番号 */
  algorithm: number
  preserveFormant: boolean
}

export type PitchResponse = { id: number; channels: Float32Array[] } | { id: number; error: string }

const scope = self as unknown as Worker

const ready: Promise<DspExports> = fetch(wasmUrl)
  .then((r) => r.arrayBuffer())
  .then((bytes) => WebAssembly.instantiate(bytes, {}))
  .then((r) => r.instance.exports as unknown as DspExports)

function process(dsp: DspExports, r: PitchRequest): Float32Array[] {
  const frames = r.channels[0]?.length ?? 0
  const len = frames * r.channels.length
  const ptr = dsp.alloc_f32(len)
  try {
    r.channels.forEach((c, i) => new Float32Array(dsp.memory.buffer, ptr, len).set(c, i * frames))
    const n = dsp.process_planar(ptr, frames, r.channels.length, r.sampleRate, r.semitones, r.stretch, r.algorithm, r.preserveFormant ? 1 : 0, 0)
    // 処理中にメモリが広がることがあるので、ビューは処理のあとに作る
    const out = new Float32Array(dsp.memory.buffer, dsp.output_ptr(), n * r.channels.length)
    return r.channels.map((_, i) => out.slice(i * n, (i + 1) * n))
  } finally {
    dsp.free_f32(ptr, len)
  }
}

scope.onmessage = async (e: MessageEvent<PitchRequest>) => {
  const req = e.data
  try {
    const channels = process(await ready, req)
    scope.postMessage({ id: req.id, channels } satisfies PitchResponse, channels.map((c) => c.buffer))
  } catch (err) {
    scope.postMessage({ id: req.id, error: String(err) } satisfies PitchResponse)
  }
}
