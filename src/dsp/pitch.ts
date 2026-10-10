// wasm の処理の窓口。波形ブロックのピッチと速度を音に反映し（作ったものはキャッシュ）、テンポを解析する。
// 元の音を CHUNK 秒ごとの「かたまり」に分けて作る（前後に余白を付ける）。区切りは元の音の時刻で決まるので、範囲の違う波形ブロックどうしでも同じかたまりを使い回す。
// 再生位置（止まっていれば編集カーソル）に近いかたまりから作り、できたものから鳴らす。
// Worker は CPU のコアに合わせて複数使う。作ったかたまりは、使われなくなってもしばらく残す（戻したときに作り直さない）
import { ALGORITHM_ID, type Clip } from 'wevocal-lib'
import { CURVE_HOP, pitchEnvAt, type Block, type Project, type Source } from '../project'
import type { DspRequest, PitchResponse } from './worker'

type Req = DspRequest extends infer T ? (T extends { id: number } ? Omit<T, 'id'> : never) : never

/** 同時に使う Worker の数: CPU のコアの数 − 1（画面と再生に 1 つ残す）、2〜4 */
const POOL = Math.max(2, Math.min(4, (navigator.hardwareConcurrency || 4) - 1))
const workers: Worker[] = []
const idle: Worker[] = []
const queue: (() => void)[] = []
let nextId = 1
const waiting = new Map<number, { done: (r: PitchResponse) => void; progress?: (p: number) => void }>()

function makeWorker() {
  const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  w.onmessage = (e: MessageEvent<PitchResponse>) => {
    const m = e.data
    const h = waiting.get(m.id)
    if (!h) return
    if ('progress' in m) return h.progress?.(m.progress)
    waiting.delete(m.id)
    h.done(m)
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
async function request(r: Req, onProgress?: (p: number) => void) {
  const w = await borrow()
  const id = nextId++
  try {
    return await new Promise<Float32Array[]>((resolve, reject) => {
      waiting.set(id, { done: (res) => ('error' in res ? reject(new Error(res.error)) : 'channels' in res ? resolve(res.channels) : undefined), progress: onProgress })
      w.postMessage({ ...r, id } as DspRequest)
    })
  } finally {
    giveBack(w)
  }
}

/** かたまりの長さ（秒）と、前後に足す余白（秒。区切りでつなぎやすいように） */
const CHUNK = 4
const MARGIN = 0.5
/** 使われなくなったかたまりを残す量（バイト） */
const KEEP_BYTES = 300 * 1024 * 1024

/** 作ったかたまり。元の音の core（余白を除く範囲）を、params の設定で変えたもの。clip は from 秒からで、速度の分だけ伸び縮みしている */
export interface Made {
  key: string
  params: string
  from: number
  core: [number, number]
  rate: number
  clip: Clip
  /** 最後に使った時刻（残すかたまりを決める） */
  used: number
}

const made = new Map<string, Made>()

/** カーブの中身を短い文字にする（キャッシュのキー） */
function curveKey(b: Block) {
  // ピッチのエンベロープも、音を作り直す条件に入れる
  const env = (b.pitchEnvelope ?? []).map((p) => `${Math.round(p.s * 1000)}:${Math.round(p.st * 100)}`).join(',')
  if (!b.curve) return env
  let h = 0
  for (const v of b.curve.st) h = (Math.imul(h, 31) + Math.round(v * 100)) | 0
  return `${b.curve.from}:${b.curve.st.length}:${h}|${env}`
}

/** 範囲のほかに、作る音を決める値 */
const paramsOf = (b: Block) => `${b.source}|${b.pitch}|${b.rate}|${b.formant}|${b.algorithm}|${b.preserveFormant}|${curveKey(b)}`

/** 波形ブロックが使う、元の音の範囲（秒） */
const spanOf = (b: Block): [number, number] => [b.offset, b.offset + b.length * b.rate]

/** 波形ブロックが使うかたまりの番号 */
function chunksOf(b: Block) {
  const [a, z] = spanOf(b)
  const out: number[] = []
  for (let k = Math.floor(a / CHUNK); k * CHUNK < z - 1e-6; k++) out.push(k)
  return out
}

/** 元の音から作り直す要るか（ピッチ、速度、フォルマント、カーブを変えたとき） */
export const needsProcess = (b: Block) => b.pitch !== 0 || b.rate !== 1 || b.formant !== 0 || !!b.curve?.st.some((v) => v !== 0) || !!b.pitchEnvelope?.some((p) => p.st !== 0)

/** 鳴らす音の 1 片。元の音の a〜z 秒を、clip（頭が元の音の from 秒）から鳴らす */
export interface Piece {
  a: number
  z: number
  clip: Clip
  from: number
}

/**
 * 波形ブロックを鳴らす片の列（元の音の時刻の順）。変えていなければ元の音の 1 片。
 * かたまりができていない所は抜ける（その所は鳴らさない）
 */
export function piecesFor(b: Block, source: Source): Piece[] {
  const [a, z] = spanOf(b)
  if (!needsProcess(b)) return [{ a, z, clip: source.clip, from: 0 }]
  const params = paramsOf(b)
  const out: Piece[] = []
  const now = performance.now()
  for (const k of chunksOf(b)) {
    const m = made.get(`${params}#${k}`)
    if (!m) continue
    m.used = now
    out.push({ a: Math.max(a, m.core[0]), z: Math.min(z, m.core[1]), clip: m.clip, from: m.from })
  }
  return out
}

/** 波形ブロックのできている割合（0〜1。描画で何 % かを出す） */
export function blockReady(b: Block) {
  if (!needsProcess(b)) return 1
  const ks = chunksOf(b)
  const params = paramsOf(b)
  return ks.length ? ks.filter((k) => made.has(`${params}#${k}`)).length / ks.length : 1
}

/** 鳴らす音を 1 つにまとめたものと、その頭が元の音の何秒か（解析の欄で使う）。まだ全部できていなければ null */
export function clipFor(b: Block, source: Source): { clip: Clip; from: number } | null {
  if (!needsProcess(b)) return { clip: source.clip, from: 0 }
  const pieces = piecesFor(b, source)
  if (!pieces.length || pieces.length !== chunksOf(b).length) return null
  if (pieces.length === 1) return { clip: pieces[0].clip, from: pieces[0].from }
  // かたまりをつないだ音を作る（つなぎ目はそのまま）
  const sr = pieces[0].clip.sampleRate
  const parts = pieces.map((pc) => {
    const s = Math.floor(((pc.a - pc.from) / b.rate) * sr)
    const e = Math.floor(((pc.z - pc.from) / b.rate) * sr)
    return pc.clip.channels.map((c) => c.subarray(s, e))
  })
  const len = parts.reduce((n, p) => n + p[0].length, 0)
  const channels = parts[0].map((_, ch) => {
    const out = new Float32Array(len)
    let at = 0
    for (const p of parts) {
      out.set(p[ch], at)
      at += p[ch].length
    }
    return out
  })
  return { clip: { sampleRate: sr, channels }, from: pieces[0].a }
}

/** まだできていない音があるか */
export function pitchPending(p: Project) {
  return p.blocks.some((b) => blockReady(b) < 1)
}

interface Want {
  key: string
  b: Block
  source: Source
  k: number
  /** 再生位置からの近さ（秒。小さいほど先に作る） */
  distance: number
}
let wanted: Want[] = []
/** 作っている途中のもの（同じものをもう一度頼まないように）と、その進み具合 */
const inflight = new Map<string, number>()
let running: Promise<void> | null = null
let madeCount = 0

/** 進み具合（ゲージ）。total は今頼まれているかたまりの数、done はそのうちできた分（途中の分を含む） */
let total = 0
let doneCount = 0
const listeners = new Set<() => void>()
export function pitchProgress() {
  const partial = [...inflight.values()].reduce((s, v) => s + v, 0)
  return { total, done: Math.min(total, doneCount + partial) }
}
export function onPitchProgress(fn: () => void) {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
const notify = () => listeners.forEach((fn) => fn())

/** 元の音の from 秒から、hop サンプルおきのピッチ比の列（カーブの外は一定のピッチ） */
function ratiosOf(b: Block, frames: number, sampleRate: number, from: number) {
  const hop = Math.round(CURVE_HOP * sampleRate)
  const out = new Float32Array(Math.ceil(frames / hop) + 1)
  const c = b.curve
  for (let k = 0; k < out.length; k++) {
    const s = from + k * CURVE_HOP
    const i = c ? Math.round((s - c.from) / CURVE_HOP) : -1
    // 基本のピッチ + ピッチカーブ + ピッチのエンベロープ
    out[k] = 2 ** ((b.pitch + (c && i >= 0 && i < c.st.length ? c.st[i] : 0) + pitchEnvAt(b.pitchEnvelope, s)) / 12)
  }
  return { ratios: out, hopSamples: hop }
}

/** かたまり 1 つを作る（Worker に渡すのは範囲の写しだけ） */
async function processChunk(w: Want): Promise<Made> {
  const { clip } = w.source
  const sr = clip.sampleRate
  const core: [number, number] = [w.k * CHUNK, Math.min(w.source.duration, (w.k + 1) * CHUNK)]
  const a = Math.max(0, Math.floor((core[0] - MARGIN) * sr))
  const z = Math.min(clip.channels[0].length, Math.ceil((core[1] + MARGIN) * sr))
  const channels = clip.channels.map((c) => c.slice(a, z))
  const b = w.b
  const out = await request(
    {
      kind: 'pitch',
      channels,
      sampleRate: sr,
      semitones: b.pitch,
      stretch: 1 / b.rate,
      algorithm: ALGORITHM_ID[b.algorithm],
      preserveFormant: b.preserveFormant || b.formant !== 0,
      formantSemitones: b.formant,
      ...(b.curve || b.pitchEnvelope?.length ? ratiosOf(b, z - a, sr, a / sr) : {}),
    },
    (p) => {
      inflight.set(w.key, p)
      notify()
    },
  )
  return { key: w.key, params: paramsOf(b), from: a / sr, core, rate: b.rate, clip: { sampleRate: sr, channels: out }, used: performance.now() }
}

/** 頼まれたものを、Worker の数だけ同時に、近い順に作る。途中で頼み直されたら、新しいものから続ける */
function run() {
  running ??= Promise.all(
    Array.from({ length: POOL }, async () => {
      for (let w = wanted.shift(); w; w = wanted.shift()) {
        inflight.set(w.key, 0)
        try {
          const m = await processChunk(w)
          made.set(m.key, m)
          madeCount++
          doneCount++
        } finally {
          inflight.delete(w.key)
          notify()
        }
      }
    }),
  )
    .then(() => {})
    .finally(() => (running = null))
  return running
}

/** 使われなくなったかたまりは、合わせて KEEP_BYTES を超えたら古い順に捨てる */
function prune(used: Set<string>) {
  const bytes = (m: Made) => m.clip.channels.reduce((n, c) => n + c.byteLength, 0)
  let sum = [...made.values()].reduce((n, m) => n + bytes(m), 0)
  for (const m of [...made.values()].filter((m) => !used.has(m.key)).sort((x, y) => x.used - y.used)) {
    if (sum <= KEEP_BYTES) break
    made.delete(m.key)
    sum -= bytes(m)
  }
}

/** プロジェクトの波形ブロックの音を用意する（around は再生位置か編集カーソル。近い所から）。新しく作ったものがあれば true */
export async function preparePitch(p: Project, around = 0) {
  const used = new Set<string>()
  const next = new Map<string, Want>()
  for (const b of p.blocks) {
    const source = p.sources.find((s) => s.id === b.source)
    if (!needsProcess(b) || !source) continue
    const params = paramsOf(b)
    for (const k of chunksOf(b)) {
      const key = `${params}#${k}`
      used.add(key)
      if (made.has(key) || inflight.has(key)) continue
      // かたまりの時間軸の上の範囲と、再生位置との近さ
      const t0 = b.start + (Math.max(b.offset, k * CHUNK) - b.offset) / b.rate
      const t1 = b.start + (Math.min(b.offset + b.length * b.rate, (k + 1) * CHUNK) - b.offset) / b.rate
      const distance = around < t0 ? t0 - around : around > t1 ? around - t1 : 0
      const old = next.get(key)
      if (!old || distance < old.distance) next.set(key, { key, b, source, k, distance })
    }
  }
  prune(used)
  wanted = [...next.values()].sort((x, y) => x.distance - y.distance)
  total = wanted.length + inflight.size
  doneCount = 0
  notify()
  const before = madeCount
  await run()
  // 途中のものを待つ（先に頼んだ側の run が終わるまで）
  while (inflight.size) await (running ?? Promise.resolve())
  total = 0
  notify()
  return madeCount > before
}

/** テンポの候補（強い順）。offset は 1 拍目の位置（秒、音の頭から） */
export async function analyzeTempo(samples: Float32Array, sampleRate: number) {
  const [raw] = await request({ kind: 'tempo', samples, sampleRate })
  const out: { bpm: number; strength: number; offset: number }[] = []
  for (let i = 0; i + 2 < raw.length; i += 3) out.push({ bpm: raw[i], strength: raw[i + 1], offset: raw[i + 2] })
  return out
}
