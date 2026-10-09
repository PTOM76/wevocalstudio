// wasm の処理の窓口。波形ブロックのピッチと速度を音に反映し（作ったものはキャッシュ）、テンポを解析する。
// 作るのは波形ブロックが使う範囲（と前後の余白）だけ。同じ音源と設定で範囲が重なる、近いものは 1 つにまとめて作る。
// Worker は CPU のコアに合わせて複数使い、長い音は区間に分けて同時に作ってつなぐ（WeVocalSynth と同じ segment）。待つ間に要らなくなったものは飛ばす。
// 作り直している間の波形ブロックは鳴らさない（元の音や前の音が一瞬鳴らないように）
import { ALGORITHM_ID, type Clip } from 'wevocal-lib'
import { CURVE_HOP, type Block, type Project, type Source } from '../project'
import type { DspRequest, PitchResponse } from './worker'

type Req = DspRequest extends infer T ? (T extends { id: number } ? Omit<T, 'id'> : never) : never

/** 同時に使う Worker の数: CPU のコアの数 − 1（画面と再生に 1 つ残す）、2〜4 */
const POOL = Math.max(2, Math.min(4, (navigator.hardwareConcurrency || 4) - 1))
const workers: Worker[] = []
const idle: Worker[] = []
const queue: (() => void)[] = []
let nextId = 1
const waiting = new Map<number, (r: PitchResponse) => void>()

function makeWorker() {
  const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  w.onmessage = (e: MessageEvent<PitchResponse>) => {
    waiting.get(e.data.id)?.(e.data)
    waiting.delete(e.data.id)
  }
  workers.push(w)
  return w
}

/** 空いている Worker を借りる（なければ作る。上限なら空くまで待つ） */
function borrow(): Promise<Worker> {
  const w = idle.pop() ?? (workers.length < POOL ? makeWorker() : null)
  if (w) return Promise.resolve(w)
  return new Promise((resolve) => queue.push(() => resolve(idle.pop()!)))
}
function giveBack(w: Worker) {
  idle.push(w)
  queue.shift()?.()
}

/** Worker に頼む（空いているものに配る。id はここで付ける） */
async function request(r: Req) {
  const w = await borrow()
  const id = nextId++
  try {
    return await new Promise<Float32Array[]>((resolve, reject) => {
      waiting.set(id, (res) => ('error' in res ? reject(new Error(res.error)) : resolve(res.channels)))
      w.postMessage({ ...r, id } as DspRequest)
    })
  } finally {
    giveBack(w)
  }
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
/** 同じ設定の範囲がこれより近ければ、つないで 1 回で作る（秒） */
const JOIN = 1
/** これより長い範囲は区間に分けて同時に作る（秒。wevocal-lib の segment の MIN_SPLIT_SEC と同じ） */
const SPLIT_SEC = 20
const EPS = 1e-3

let made: Made[] = []

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

/** 同じ設定で、範囲を含む作った音（分割した波形ブロック、写した波形ブロックは同じものを使う） */
function covering(b: Block) {
  const params = paramsOf(b)
  const [a, z] = spanOf(b)
  return made.find((m) => m.params === params && covers(m, a, z))
}

/** 元の音から作り直す要るか（ピッチ、速度、フォルマント、カーブを変えたとき） */
export const needsProcess = (b: Block) => b.pitch !== 0 || b.rate !== 1 || b.formant !== 0 || !!b.curve?.st.some((v) => v !== 0)

/** 鳴らす音と、その頭が元の音の何秒か。変えていなければ元の音。作り直している間は null（鳴らさない） */
export function clipFor(b: Block, source: Source): { clip: Clip; from: number } | null {
  if (!needsProcess(b)) return { clip: source.clip, from: 0 }
  return covering(b) ?? null
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
/** これから作るもの。新しく頼まれたら入れ替える */
let wanted: Want[] = []
/** 作っている途中のもの（同じものをもう一度頼まないように） */
const inflight = new Set<Want>()
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

/** 1 つの範囲の音を作る（Worker に渡すのは範囲の写しだけ） */
function pitchRequest(b: Block, channels: Float32Array[], sampleRate: number, fromSec: number): Req {
  return {
    kind: 'pitch',
    channels,
    sampleRate,
    semitones: b.pitch,
    stretch: 1 / b.rate,
    algorithm: ALGORITHM_ID[b.algorithm],
    preserveFormant: b.preserveFormant || b.formant !== 0,
    formantSemitones: b.formant,
    ...(b.curve ? ratiosOf(b, channels[0].length, sampleRate, fromSec) : {}),
  }
}

/** 長い範囲を区間に分け、別々の Worker で同時に作ってつなぐ（WeVocalSynth の parallel.ts と同じ） */
async function processSplit(b: Block, channels: Float32Array[], sampleRate: number, fromSec: number) {
  const frames = channels[0].length
  const [raw] = await request({ kind: 'segplan', frames, sampleRate })
  const plan = new Float64Array(raw.buffer, raw.byteOffset, raw.byteLength / 8)
  const count = plan.length / 4
  const outs = await Promise.all(
    Array.from({ length: count }, (_, k) => {
      const [a, z] = [plan[k * 4 + 2], plan[k * 4 + 3]]
      return request(pitchRequest(b, channels.map((c) => c.slice(a, z)), sampleRate, fromSec + a / sampleRate))
    }),
  )
  return request({ kind: 'stitch', channels: outs.flat(), frames, channelCount: channels.length, sampleRate, stretch: 1 / b.rate })
}

async function processSpan(w: Want): Promise<Made> {
  const { clip } = w.source
  const a = Math.floor(w.from * clip.sampleRate)
  const z = Math.min(clip.channels[0].length, Math.ceil(w.to * clip.sampleRate))
  const channels = clip.channels.map((c) => c.slice(a, z))
  const fromSec = a / clip.sampleRate
  // カーブは区間の境目で比が変わるとつなぎにくいので、分けない
  const split = !w.b.curve && z - a >= SPLIT_SEC * clip.sampleRate
  const out = split ? await processSplit(w.b, channels, clip.sampleRate, fromSec) : await request(pitchRequest(w.b, channels, clip.sampleRate, fromSec))
  return { params: paramsOf(w.b), from: fromSec, to: z / clip.sampleRate, rate: w.b.rate, clip: { sampleRate: clip.sampleRate, channels: out } }
}

/** 頼まれたものを、Worker の数だけ同時に作る。途中で頼み直されたら、新しいものから続ける */
function run() {
  running ??= Promise.all(
    Array.from({ length: POOL }, async () => {
      for (let w = wanted.shift(); w; w = wanted.shift()) {
        inflight.add(w)
        try {
          made.push(await processSpan(w))
          madeCount++
        } finally {
          inflight.delete(w)
        }
      }
    }),
  )
    .then(() => {})
    .finally(() => (running = null))
  return running
}

/** 同じ設定で、範囲が重なる、近いものをつなぐ（同じ音源で同じピッチのところを何度も作らない） */
function joinWants(list: Want[]) {
  const byParams = new Map<string, Want[]>()
  for (const w of list) byParams.set(paramsOf(w.b), [...(byParams.get(paramsOf(w.b)) ?? []), w])
  const out: Want[] = []
  for (const group of byParams.values()) {
    group.sort((x, y) => x.from - y.from)
    let cur = { ...group[0] }
    for (const w of group.slice(1)) {
      if (w.from <= cur.to + JOIN) cur.to = Math.max(cur.to, w.to)
      else {
        out.push(cur)
        cur = { ...w }
      }
    }
    out.push(cur)
  }
  return out
}

/** プロジェクトの波形ブロックの音をすべて用意する。使われなくなったキャッシュは消す。新しく作ったものがあれば true */
export async function preparePitch(p: Project, around = 0) {
  const keep = new Set<Made>()
  const list: Want[] = []
  for (const b of p.blocks) {
    const source = p.sources.find((s) => s.id === b.source)
    if (!needsProcess(b) || !source) continue
    const m = covering(b)
    if (m) {
      keep.add(m)
      continue
    }
    const [a, z] = spanOf(b)
    // 作っている途中のものが含んでいれば、それを待つ
    if ([...inflight].some((w) => paramsOf(w.b) === paramsOf(b) && w.from <= a + EPS && w.to >= z - EPS)) continue
    list.push({ b, source, from: Math.max(0, a - MARGIN), to: Math.min(source.duration, z + MARGIN) })
  }
  made = made.filter((m) => keep.has(m))
  // 再生位置（止まっていれば編集カーソル）に近い所から作る（すぐ聞く所を先に）
  const distance = (w: Want) => {
    const t0 = w.b.start + (w.from - w.b.offset) / w.b.rate
    const t1 = w.b.start + (w.to - w.b.offset) / w.b.rate
    return around < t0 ? t0 - around : around > t1 ? around - t1 : 0
  }
  wanted = joinWants(list).sort((x, y) => distance(x) - distance(y))
  const before = madeCount
  await run()
  // 途中のものを待つ（最初に頼んだ側の run が終わるまで）
  while (inflight.size) await (running ?? Promise.resolve())
  return madeCount > before
}

/** テンポの候補（強い順）。offset は 1 拍目の位置（秒、音の頭から） */
export async function analyzeTempo(samples: Float32Array, sampleRate: number) {
  const [raw] = await request({ kind: 'tempo', samples, sampleRate })
  const out: { bpm: number; strength: number; offset: number }[] = []
  for (let i = 0; i + 2 < raw.length; i += 3) out.push({ bpm: raw[i], strength: raw[i + 1], offset: raw[i + 2] })
  return out
}
