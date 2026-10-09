// wasm の処理の窓口。波形ブロックのピッチと速度を音に反映し（作ったものはキャッシュ）、テンポを解析する。元の音全体を変えて作り、キャッシュする（再生のたびには計算しない）
import { ALGORITHM_ID, type Clip } from 'wevocal-lib'
import { CURVE_HOP, type Block, type Project, type Source } from '../project'
import type { DspRequest, PitchResponse } from './worker'

let worker: Worker | null = null
let nextId = 1
const waiting = new Map<number, (r: PitchResponse) => void>()

/** Worker に頼む（id はここで付ける） */
function request(r: DspRequest extends infer T ? (T extends { id: number } ? Omit<T, 'id'> : never) : never) {
  worker ??= new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e: MessageEvent<PitchResponse>) => {
    waiting.get(e.data.id)?.(e.data)
    waiting.delete(e.data.id)
  }
  const id = nextId++
  return new Promise<Float32Array[]>((resolve, reject) => {
    waiting.set(id, (res) => ('error' in res ? reject(new Error(res.error)) : resolve(res.channels)))
    worker!.postMessage({ ...r, id } as DspRequest)
  })
}

/** キャッシュ。キーは元の音、ピッチ、処理方式、フォルマント（どれも波形ブロックが持つ）。分割した波形ブロックどうしは同じものを使う */
const jobs = new Map<string, Promise<Clip>>()
const done = new Map<string, Clip>()

/** カーブの中身を短い文字にする（キャッシュのキー） */
function curveKey(b: Block) {
  if (!b.curve) return ''
  let h = 0
  for (const v of b.curve.st) h = (Math.imul(h, 31) + Math.round(v * 100)) | 0
  return `${b.curve.from}:${b.curve.st.length}:${h}`
}

const keyOf = (b: Block) => `${b.source}|${b.pitch}|${b.rate}|${b.formant}|${b.algorithm}|${b.preserveFormant}|${curveKey(b)}`

/** 元の音の全体にわたるピッチ比の列（カーブの外は一定のピッチ）。hop サンプルおき */
function ratiosOf(b: Block, frames: number, sampleRate: number) {
  const hop = Math.round(CURVE_HOP * sampleRate)
  const out = new Float32Array(Math.ceil(frames / hop) + 1)
  const c = b.curve!
  for (let k = 0; k < out.length; k++) {
    const i = Math.round((k * CURVE_HOP - c.from) / CURVE_HOP)
    out[k] = 2 ** ((b.pitch + (i >= 0 && i < c.st.length ? c.st[i] : 0)) / 12)
  }
  return { ratios: out, hopSamples: hop }
}

/** 元の音から作り直す要るか（ピッチか速度を変えたとき） */
export const needsProcess = (b: Block) => b.pitch !== 0 || b.rate !== 1 || b.formant !== 0 || !!b.curve?.st.some((v) => v !== 0)

/** 鳴らす音。ピッチを変えたものがまだできていなければ null（呼ぶ側は元の音で代わりに鳴らす） */
export function clipFor(b: Block, source: Source): Clip | null {
  return !needsProcess(b) ? source.clip : (done.get(keyOf(b)) ?? null)
}

/** まだできていないピッチの音があるか */
export function pitchPending(p: Project) {
  return p.blocks.some((b) => needsProcess(b) && !done.has(keyOf(b)))
}

/** プロジェクトの波形ブロックのピッチをすべて用意する。使われなくなったキャッシュは消す */
export async function preparePitch(p: Project) {
  const used = new Set<string>()
  const pending: Promise<Clip>[] = []
  for (const b of p.blocks) {
    const source = p.sources.find((s) => s.id === b.source)
    if (!needsProcess(b) || !source) continue
    const key = keyOf(b)
    used.add(key)
    let job = jobs.get(key)
    if (!job) {
      const { clip } = source
      job = request({ kind: 'pitch', channels: clip.channels, sampleRate: clip.sampleRate, semitones: b.pitch, stretch: 1 / b.rate, algorithm: ALGORITHM_ID[b.algorithm], preserveFormant: b.preserveFormant || b.formant !== 0, formantSemitones: b.formant, ...(b.curve ? ratiosOf(b, clip.channels[0].length, clip.sampleRate) : {}) }).then((channels) => {
        const out = { sampleRate: clip.sampleRate, channels }
        // 待つ間に使われなくなったものは残さない
        if (jobs.get(key) === job) done.set(key, out)
        return out
      })
      // 失敗したものは次にもう一度作れるように消す
      job.catch(() => jobs.delete(key))
      jobs.set(key, job)
    }
    if (!done.has(key)) pending.push(job)
  }
  for (const key of jobs.keys()) {
    if (used.has(key)) continue
    jobs.delete(key)
    done.delete(key)
  }
  await Promise.all(pending)
  return pending.length > 0
}

/** テンポの候補（強い順）。offset は 1 拍目の位置（秒、音の頭から） */
export async function analyzeTempo(samples: Float32Array, sampleRate: number) {
  const [raw] = await request({ kind: 'tempo', samples, sampleRate })
  const out: { bpm: number; strength: number; offset: number }[] = []
  for (let i = 0; i + 2 < raw.length; i += 3) out.push({ bpm: raw[i], strength: raw[i + 1], offset: raw[i + 2] })
  return out
}
