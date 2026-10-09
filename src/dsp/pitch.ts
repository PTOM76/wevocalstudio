// wasm の処理の窓口。波形ブロックのピッチと速度を音に反映し（作ったものはキャッシュ）、テンポを解析する。
// 作るのは波形ブロックが使う範囲（と前後の余白）だけ。Worker には 1 つずつ頼み、待つ間に要らなくなったものは飛ばす。
// 新しい音ができるまでは、その波形ブロックの前の音で鳴らす（元の音が一瞬鳴らないように）
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

/** 作った音。元の音の from〜to 秒を、params の設定で変えたもの */
export interface Made {
  params: string
  from: number
  to: number
  rate: number
  clip: Clip
}

/** 前後に足す余白（秒。少し端を動かしても作り直さずに済むように） */
const MARGIN = 0.5
const EPS = 1e-3

let made: Made[] = []
/** 波形ブロックごとの、最後に鳴らせた音（新しい音ができるまで使う） */
const lastByBlock = new Map<string, Made>()

/** カーブの中身を短い文字にする（キャッシュのキー） */
function curveKey(b: Block) {
  if (!b.curve) return ''
  let h = 0
  for (const v of b.curve.st) h = (Math.imul(h, 31) + Math.round(v * 100)) | 0
  return `${b.curve.from}:${b.curve.st.length}:${h}`
}

/** 範囲のほかに、作る音を決める値 */
const paramsOf = (b: Block) => `${b.source}|${b.pitch}|${b.rate}|${b.formant}|${b.algorithm}|${b.preserveFormant}|${curveKey(b)}`

/** 波形ブロックが使う、元の音の範囲（秒） */
const spanOf = (b: Block): [number, number] => [b.offset, b.offset + b.length * b.rate]

const covers = (m: Made, a: number, z: number) => m.from <= a + EPS && m.to >= z - EPS

/** 同じ設定で、範囲を含む作った音（分割した波形ブロックどうしは同じものを使う） */
function covering(b: Block) {
  const params = paramsOf(b)
  const [a, z] = spanOf(b)
  return made.find((m) => m.params === params && covers(m, a, z))
}

/** 元の音から作り直す要るか（ピッチ、速度、フォルマント、カーブを変えたとき） */
export const needsProcess = (b: Block) => b.pitch !== 0 || b.rate !== 1 || b.formant !== 0 || !!b.curve?.st.some((v) => v !== 0)

/**
 * 鳴らす音と、その頭が元の音の何秒か。変えていなければ元の音。
 * まだできていなければ、同じ速度で範囲を含む前の音（ピッチは古いまま）、それもなければ null（呼ぶ側は元の音を速度の分だけ速く鳴らす）
 */
export function clipFor(b: Block, source: Source): { clip: Clip; from: number } | null {
  if (!needsProcess(b)) return { clip: source.clip, from: 0 }
  const m = covering(b)
  if (m) return m
  const last = lastByBlock.get(b.id)
  const [a, z] = spanOf(b)
  return last && last.params.startsWith(`${b.source}|`) && last.rate === b.rate && covers(last, a, z) ? last : null
}

/** まだできていない音があるか */
export function pitchPending(p: Project) {
  return p.blocks.some((b) => needsProcess(b) && !covering(b))
}

interface Want {
  b: Block
  source: Source
  from: number
  to: number
}
/** これから作るもの（キーは設定と範囲）。新しく頼まれたら入れ替える */
let wanted = new Map<string, Want>()
let running: Promise<void> | null = null
let madeCount = 0

/** 元の音の from 秒から、hop サンプルおきのピッチ比の列（カーブの外は一定のピッチ） */
function ratiosOf(b: Block, frames: number, sampleRate: number, from: number) {
  const hop = Math.round(CURVE_HOP * sampleRate)
  const out = new Float32Array(Math.ceil(frames / hop) + 1)
  const c = b.curve!
  for (let k = 0; k < out.length; k++) {
    const i = Math.round((from + k * CURVE_HOP - c.from) / CURVE_HOP)
    out[k] = 2 ** ((b.pitch + (i >= 0 && i < c.st.length ? c.st[i] : 0)) / 12)
  }
  return { ratios: out, hopSamples: hop }
}

/** 元の音の範囲だけを Worker に渡して作る（渡すのは範囲の写しだけ） */
async function processSpan(w: Want): Promise<Made> {
  const { clip } = w.source
  const a = Math.floor(w.from * clip.sampleRate)
  const z = Math.min(clip.channels[0].length, Math.ceil(w.to * clip.sampleRate))
  const channels = clip.channels.map((c) => c.slice(a, z))
  const b = w.b
  const out = await request({
    kind: 'pitch',
    channels,
    sampleRate: clip.sampleRate,
    semitones: b.pitch,
    stretch: 1 / b.rate,
    algorithm: ALGORITHM_ID[b.algorithm],
    preserveFormant: b.preserveFormant || b.formant !== 0,
    formantSemitones: b.formant,
    ...(b.curve ? ratiosOf(b, z - a, clip.sampleRate, a / clip.sampleRate) : {}),
  })
  return { params: paramsOf(b), from: a / clip.sampleRate, to: z / clip.sampleRate, rate: b.rate, clip: { sampleRate: clip.sampleRate, channels: out } }
}

/** 頼まれたものを 1 つずつ作る。途中で頼み直されたら、新しいものから続ける */
function run() {
  running ??= (async () => {
    while (wanted.size) {
      const [key, w] = wanted.entries().next().value as [string, Want]
      wanted.delete(key)
      const m = await processSpan(w)
      made.push(m)
      lastByBlock.set(w.b.id, m)
      madeCount++
    }
  })().finally(() => (running = null))
  return running
}

/** プロジェクトの波形ブロックの音をすべて用意する。使われなくなったキャッシュは消す。新しく作ったものがあれば true */
export async function preparePitch(p: Project) {
  const keep = new Set<Made>()
  const next = new Map<string, Want>()
  for (const b of p.blocks) {
    const source = p.sources.find((s) => s.id === b.source)
    if (!needsProcess(b) || !source) continue
    const m = covering(b)
    if (m) {
      keep.add(m)
      lastByBlock.set(b.id, m)
      continue
    }
    // できるまで鳴らす前の音は残す
    const last = lastByBlock.get(b.id)
    if (last) keep.add(last)
    const [a, z] = spanOf(b)
    const from = Math.max(0, a - MARGIN)
    const to = Math.min(source.duration, z + MARGIN)
    next.set(`${paramsOf(b)}@${from.toFixed(3)}-${to.toFixed(3)}`, { b, source, from, to })
  }
  made = made.filter((m) => keep.has(m))
  for (const id of lastByBlock.keys()) if (!p.blocks.some((b) => b.id === id)) lastByBlock.delete(id)
  wanted = next
  const before = madeCount
  await run()
  return madeCount > before
}

/** テンポの候補（強い順）。offset は 1 拍目の位置（秒、音の頭から） */
export async function analyzeTempo(samples: Float32Array, sampleRate: number) {
  const [raw] = await request({ kind: 'tempo', samples, sampleRate })
  const out: { bpm: number; strength: number; offset: number }[] = []
  for (let i = 0; i + 2 < raw.length; i += 3) out.push({ bpm: raw[i], strength: raw[i + 1], offset: raw[i + 2] })
  return out
}
