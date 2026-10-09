// 作業の自動保存と復元（IndexedDB）。元の音は書き換えないので 1 回だけ書き、トラックと波形ブロックは変わるたびに書く
import type { Clip } from 'wevocal-lib'
import { app } from './appConfig'
import { DEFAULT_TEMPO, fillBlock, newProject, type Project, type Source } from './project'

const DB = app.id
const STORE = 'kv'
const META = 'autosave:meta'
const sourceKey = (id: string) => `autosave:source:${id}`

interface Meta {
  fileName: string
  sources: { id: string; name: string; sampleRate: number }[]
  tempo?: Project['tempo']
  master: Project['master']
  tracks: Project['tracks']
  blocks: Project['blocks']
}

let dbPromise: Promise<IDBDatabase> | null = null
function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const store = (await db()).transaction(STORE, mode).objectStore(STORE)
  const req = fn(store)
  return new Promise((resolve, reject) => {
    store.transaction.oncomplete = () => resolve(req ? req.result : undefined)
    store.transaction.onerror = () => reject(store.transaction.error)
  })
}

/** 書いた元の音（同じものを何度も書かない） */
const written = new Set<string>()

/** 今の作業を書く。元の音はまだ書いていないものだけ、使われなくなったものは消す */
export async function saveAutosave(p: Project, fileName: string) {
  for (const s of p.sources) {
    if (written.has(s.id)) continue
    await run('readwrite', (st) => st.put(s.clip.channels, sourceKey(s.id)))
    written.add(s.id)
  }
  const meta: Meta = {
    fileName,
    sources: p.sources.map((s) => ({ id: s.id, name: s.name, sampleRate: s.clip.sampleRate })),
    tempo: p.tempo,
    master: p.master,
    tracks: p.tracks,
    blocks: p.blocks,
  }
  const used = new Set(p.sources.map((s) => s.id))
  await run('readwrite', (st) => {
    st.put(meta, META)
    for (const id of written) if (!used.has(id)) st.delete(sourceKey(id))
  })
  for (const id of [...written]) if (!used.has(id)) written.delete(id)
}

/** 前回の作業。なければ null */
export async function loadAutosave(): Promise<{ project: Project; fileName: string } | null> {
  const meta = (await run<Meta>('readonly', (st) => st.get(META))) as Meta | undefined
  if (!meta || !meta.blocks?.length) return null
  const sources: Source[] = []
  for (const s of meta.sources) {
    const channels = (await run<Float32Array[]>('readonly', (st) => st.get(sourceKey(s.id)))) as Float32Array[] | undefined
    if (!channels?.length) continue
    const clip: Clip = { sampleRate: s.sampleRate, channels }
    sources.push({ id: s.id, name: s.name, clip, duration: channels[0].length / s.sampleRate })
    written.add(s.id)
  }
  // 元の音が読めなかった波形ブロックは除く
  const blocks = meta.blocks.filter((b) => sources.some((s) => s.id === b.source)).map(fillBlock)
  const base = newProject()
  return { project: { sources, tempo: { ...DEFAULT_TEMPO, ...meta.tempo }, master: { ...base.master, ...meta.master }, tracks: meta.tracks?.length ? meta.tracks : base.tracks, blocks }, fileName: meta.fileName }
}

/** 自動保存を消す（自動保存をやめたとき） */
export async function clearAutosave() {
  await run('readwrite', (st) => st.clear())
  written.clear()
}
