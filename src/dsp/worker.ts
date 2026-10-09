// wasm の処理（ピッチと速度の変更、テンポの解析）を画面のスレッドの外で行う Worker
import wasmUrl from './dsp.wasm?url'

interface DspExports {
  memory: WebAssembly.Memory
  alloc_f32(len: number): number
  free_f32(ptr: number, len: number): void
  process_planar(input: number, frames: number, channels: number, sampleRate: number, semitones: number, stretch: number, algorithm: number, preserveFormant: number, formantSemitones: number): number
  process_curve_planar(input: number, frames: number, channels: number, sampleRate: number, ratios: number, ratioCount: number, hop: number, algorithm: number, preserveFormant: number, formantSemitones: number, stretch: number): number
  analyze_tempo(input: number, frames: number, sampleRate: number): number
  output_ptr(): number
}

export interface PitchRequest {
  kind: 'pitch'
  id: number
  channels: Float32Array[]
  sampleRate: number
  semitones: number
  /** 長さの倍率（速度の逆数） */
  stretch: number
  /** wevocal-lib の ALGORITHM_ID の番号 */
  algorithm: number
  preserveFormant: boolean
  /** フォルマントのずらし量（半音。preserveFormant のときだけ効く） */
  formantSemitones: number
  /** ピッチカーブ（hopSamples おきのピッチ比）。あれば semitones の代わりにこれを使う */
  ratios?: Float32Array
  hopSamples?: number
}

/** テンポの解析（モノラル） */
export interface TempoRequest {
  kind: 'tempo'
  id: number
  samples: Float32Array
  sampleRate: number
}

export type DspRequest = PitchRequest | TempoRequest

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
    let n: number
    if (r.ratios) {
      const ratios = r.ratios
      const rp = dsp.alloc_f32(ratios.length)
      try {
        new Float32Array(dsp.memory.buffer, rp, ratios.length).set(ratios)
        n = dsp.process_curve_planar(ptr, frames, r.channels.length, r.sampleRate, rp, ratios.length, r.hopSamples ?? 441, r.algorithm, r.preserveFormant ? 1 : 0, r.formantSemitones, r.stretch)
      } finally {
        dsp.free_f32(rp, ratios.length)
      }
    } else n = dsp.process_planar(ptr, frames, r.channels.length, r.sampleRate, r.semitones, r.stretch, r.algorithm, r.preserveFormant ? 1 : 0, r.formantSemitones)
    // 処理中にメモリが広がることがあるので、ビューは処理のあとに作る
    const out = new Float32Array(dsp.memory.buffer, dsp.output_ptr(), n * r.channels.length)
    return r.channels.map((_, i) => out.slice(i * n, (i + 1) * n))
  } finally {
    dsp.free_f32(ptr, len)
  }
}

function tempo(dsp: DspExports, r: TempoRequest): Float32Array[] {
  const ptr = dsp.alloc_f32(r.samples.length)
  try {
    new Float32Array(dsp.memory.buffer, ptr, r.samples.length).set(r.samples)
    const n = dsp.analyze_tempo(ptr, r.samples.length, r.sampleRate)
    return [new Float32Array(dsp.memory.buffer, dsp.output_ptr(), n).slice()]
  } finally {
    dsp.free_f32(ptr, r.samples.length)
  }
}

scope.onmessage = async (e: MessageEvent<DspRequest>) => {
  const req = e.data
  try {
    const dsp = await ready
    const channels = req.kind === 'tempo' ? tempo(dsp, req) : process(dsp, req)
    scope.postMessage({ id: req.id, channels } satisfies PitchResponse, channels.map((c) => c.buffer))
  } catch (err) {
    scope.postMessage({ id: req.id, error: String(err) } satisfies PitchResponse)
  }
}
