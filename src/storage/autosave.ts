// 作業の自動保存と復元（IndexedDB）。元の音は書き換えないので 1 回だけ書き、トラックと波形ブロックは変わるたびに書く。書き込みは Worker
import type { Clip } from 'wevocal-lib'
import { DEFAULT_TEMPO, fillBlock, newProject, type Project, type Source } from '../project'
import type { AutosaveMessage, AutosaveReply } from './autosaveWorker'

const META = 'autosave:meta'
const sourceKey = (id: string) => `autosave:source:${id}`
/** 一度に Worker に渡す大きさ（サンプル数。4 MB） */
const CHUNK = 1 << 20

interface Meta {
  fileName: string
  sources: { id: string; name: string; sampleRate: number }[]
  tempo?: Project['tempo']
  markers?: Project['markers']
  master: Project['master']
  tracks: Project['tracks']
  blocks: Project['blocks']
}

let worker: Worker | null = null
const waiting = new Map<number, (r: AutosaveReply) => void>()
let nextId = 1
function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./autosaveWorker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<AutosaveReply>) => {
      waiting.get(e.data.id)?.(e.data)
      waiting.delete(e.data.id)
    }
  }
  return worker
}
const send = (m: AutosaveMessage, transfer: Transferable[] = []) => getWorker().postMessage(m, transfer)

function get<T>(key: string): Promise<T | undefined> {
  const id = nextId++
  return new Promise((resolve, reject) => {
    waiting.set(id, (r) => (r.error ? reject(new Error(r.error)) : resolve(r.value as T | undefined)))
    send({ type: 'get', key, id })
  })
}

/** ブラウザが空くまで待つ（画面の操作を先にする） */
const idle = () => new Promise<void>((r) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(() => r(), { timeout: 500 }) : setTimeout(r, 0)))

/** 書いた元の音（同じものを何度も書かない） */
const written = new Set<string>()
/** 書いている途中の元の音 */
const writing = new Set<string>()

/** 元の音を小分けにして Worker に渡す。複製は 4 MB ずつで、そのたびに画面に順番を譲る */
async function writeSource(s: Source) {
  const key = sourceKey(s.id)
  const { channels } = s.clip
  send({ type: 'begin', key, channels: channels.length, length: channels[0].length })
  for (const [c, data] of channels.entries()) {
    for (let offset = 0; offset < data.length; offset += CHUNK) {
      await idle()
      const part = data.slice(offset, offset + CHUNK)
      send({ type: 'chunk', key, channel: c, offset, data: part }, [part.buffer])
    }
  }
  send({ type: 'end', key })
}

/** 今の作業を書く。元の音はまだ書いていないものだけ、使われなくなったものは消す */
export async function saveAutosave(p: Project, fileName: string) {
  for (const s of p.sources) {
    if (written.has(s.id) || writing.has(s.id)) continue
    writing.add(s.id)
    await writeSource(s).finally(() => writing.delete(s.id))
    written.add(s.id)
  }
  const meta: Meta = {
    fileName,
    sources: p.sources.map((s) => ({ id: s.id, name: s.name, sampleRate: s.clip.sampleRate })),
    tempo: p.tempo,
    markers: p.markers,
    master: p.master,
    tracks: p.tracks,
    blocks: p.blocks,
  }
  send({ type: 'put', key: META, value: meta })
  const used = new Set(p.sources.map((s) => s.id))
  const unused = [...written].filter((id) => !used.has(id))
  if (unused.length) {
    send({ type: 'delete', keys: unused.map(sourceKey) })
    for (const id of unused) written.delete(id)
  }
}

/** 前回の作業。なければ null */
export async function loadAutosave(): Promise<{ project: Project; fileName: string } | null> {
  const meta = await get<Meta>(META)
  if (!meta || !meta.blocks?.length) return null
  const sources: Source[] = []
  for (const s of meta.sources) {
    const channels = await get<Float32Array[]>(sourceKey(s.id))
    if (!channels?.length) continue
    const clip: Clip = { sampleRate: s.sampleRate, channels }
    sources.push({ id: s.id, name: s.name, clip, duration: channels[0].length / s.sampleRate })
    written.add(s.id)
  }
  // 元の音が読めなかった波形ブロックは除く
  const blocks = meta.blocks.filter((b) => sources.some((s) => s.id === b.source)).map(fillBlock)
  const base = newProject()
  return {
    project: { sources, tempo: { ...DEFAULT_TEMPO, ...meta.tempo }, markers: meta.markers ?? [], master: { ...base.master, ...meta.master }, tracks: meta.tracks?.length ? meta.tracks : base.tracks, blocks },
    fileName: meta.fileName,
  }
}

/** 自動保存を消す（自動保存をやめたとき） */
export async function clearAutosave() {
  send({ type: 'clear' })
  written.clear()
}
