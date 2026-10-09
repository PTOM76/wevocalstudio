// プロジェクトファイル（.wvstudio）の読み書き。先頭に JSON（トラック、波形ブロック、元の音の形）、そのあとに元の音の PCM を並べる
import type { Clip } from 'wevocal-lib'
import { DEFAULT_TEMPO, fillBlock, newProject, type Project, type Source } from './project'

export const PROJECT_EXT = '.wvstudio'
const MAGIC = 'WVST'
/** 形を変えたら上げる。古い版は読み替える（docs/ARCHITECTURE.md の「保存したデータは壊さない」） */
const VERSION = 1

interface StoredSource {
  id: string
  name: string
  sampleRate: number
  channels: number
  frames: number
}

interface Header {
  version: number
  sources: StoredSource[]
  tempo?: Project['tempo']
  master: Project['master']
  tracks: Project['tracks']
  blocks: Project['blocks']
}

/** プロジェクトを 1 つのファイルにする。PCM は 32bit float のまま（元の音を劣化させない） */
export function writeProject(p: Project): Blob {
  const header: Header = {
    version: VERSION,
    sources: p.sources.map((s) => ({ id: s.id, name: s.name, sampleRate: s.clip.sampleRate, channels: s.clip.channels.length, frames: s.clip.channels[0].length })),
    tempo: p.tempo,
    master: p.master,
    tracks: p.tracks,
    blocks: p.blocks,
  }
  const json = new TextEncoder().encode(JSON.stringify(header))
  // PCM を 4 バイト境界から始める（Float32Array で直接読めるように）
  const pad = (4 - ((8 + json.length) % 4)) % 4
  const head = new Uint8Array(8 + json.length + pad)
  head.set(new TextEncoder().encode(MAGIC), 0)
  new DataView(head.buffer).setUint32(4, json.length, true)
  head.set(json, 8)
  const pcm = p.sources.flatMap((s) => s.clip.channels.map((c) => c as Float32Array<ArrayBuffer>))
  return new Blob([head, ...pcm], { type: 'application/octet-stream' })
}

export async function readProject(file: Blob): Promise<Project> {
  const buf = await file.arrayBuffer()
  const view = new DataView(buf)
  if (buf.byteLength < 8 || new TextDecoder().decode(new Uint8Array(buf, 0, 4)) !== MAGIC) throw new Error('not a WeVocal Studio project')
  const length = view.getUint32(4, true)
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, length))) as Header
  if (header.version > VERSION) throw new Error('this project was saved by a newer version')
  let at = 8 + length + ((4 - ((8 + length) % 4)) % 4)
  const sources: Source[] = header.sources.map((s) => {
    const channels: Float32Array[] = []
    for (let c = 0; c < s.channels; c++) {
      channels.push(new Float32Array(buf, at, s.frames).slice())
      at += s.frames * 4
    }
    const clip: Clip = { sampleRate: s.sampleRate, channels }
    return { id: s.id, name: s.name, clip, duration: s.frames / s.sampleRate }
  })
  // 足した項目が古いファイルに無くても動くよう、既定値で埋める
  return { ...newProject(), sources, tempo: { ...DEFAULT_TEMPO, ...header.tempo }, master: { ...newProject().master, ...header.master }, tracks: header.tracks, blocks: header.blocks.map(fillBlock) }
}
