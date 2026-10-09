// 波形ブロックのピッチを音に反映する。元の音全体をピッチだけ変えて作り、キャッシュする（再生のたびには計算しない）
import { ALGORITHM_ID, type Clip } from 'wevocal-lib'
import type { Block, Project, Source } from '../project'
import type { PitchRequest, PitchResponse } from './worker'

let worker: Worker | null = null
let nextId = 1
const waiting = new Map<number, (r: PitchResponse) => void>()

function request(r: Omit<PitchRequest, 'id'>) {
  worker ??= new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e: MessageEvent<PitchResponse>) => {
    waiting.get(e.data.id)?.(e.data)
    waiting.delete(e.data.id)
  }
  const id = nextId++
  return new Promise<Float32Array[]>((resolve, reject) => {
    waiting.set(id, (res) => ('error' in res ? reject(new Error(res.error)) : resolve(res.channels)))
    worker!.postMessage({ ...r, id } satisfies PitchRequest)
  })
}

/** キャッシュ。キーは元の音、ピッチ、処理方式、フォルマント（どれも波形ブロックが持つ）。分割した波形ブロックどうしは同じものを使う */
const jobs = new Map<string, Promise<Clip>>()
const done = new Map<string, Clip>()

const keyOf = (b: Block) => `${b.source}|${b.pitch}|${b.algorithm}|${b.preserveFormant}`

/** 鳴らす音。ピッチを変えたものがまだできていなければ null（呼ぶ側は元の音で代わりに鳴らす） */
export function clipFor(b: Block, source: Source): Clip | null {
  return b.pitch === 0 ? source.clip : (done.get(keyOf(b)) ?? null)
}

/** まだできていないピッチの音があるか */
export function pitchPending(p: Project) {
  return p.blocks.some((b) => b.pitch !== 0 && !done.has(keyOf(b)))
}

/** プロジェクトの波形ブロックのピッチをすべて用意する。使われなくなったキャッシュは消す */
export async function preparePitch(p: Project) {
  const used = new Set<string>()
  const pending: Promise<Clip>[] = []
  for (const b of p.blocks) {
    const source = p.sources.find((s) => s.id === b.source)
    if (b.pitch === 0 || !source) continue
    const key = keyOf(b)
    used.add(key)
    let job = jobs.get(key)
    if (!job) {
      const { clip } = source
      job = request({ channels: clip.channels, sampleRate: clip.sampleRate, semitones: b.pitch, algorithm: ALGORITHM_ID[b.algorithm], preserveFormant: b.preserveFormant }).then((channels) => {
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
