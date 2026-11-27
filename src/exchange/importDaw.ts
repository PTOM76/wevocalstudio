// ほかの DAW のプロジェクト（.rpp、.dawproject、それらを入れた zip）を開く（memo/daw-exchange.md）。音声は zip の中か、一緒に選んだファイルから名前で探す
import { readZip } from 'pevenmui/web'
import { decodeFile, type Clip } from 'wevocal-lib'
import type { Project } from '../project'
import { readDawproject } from './dawprojectRead'
import { baseName, fromExchange } from './fromExchange'
import { readRpp } from './rppRead'
import type { XProject } from './exchange'

const ext = (name: string) => name.toLowerCase().match(/\.[^.]+$/)?.[0] ?? ''
/** ほかの DAW のプロジェクトとして開くファイルか（zip は中を見るまで分からないので、開いてみる） */
export const isDawFile = (f: File) => ['.rpp', '.dawproject', '.zip'].includes(ext(f.name))
export const DAW_ACCEPT = '.rpp,.dawproject,.zip'

export interface DawImport {
  project: Project
  name: string
  /** 見つからなかった音声の数 */
  missing: number
  /** 読めなかったクリップやアイテムの数 */
  skipped: number
}

/** files のうち、ほかの DAW のプロジェクトを 1 つ開く。残りのファイルは音声の候補にする。プロジェクトが無ければ null */
export async function importDaw(files: File[]): Promise<DawImport | null> {
  const main = files.find((f) => ext(f.name) === '.rpp') ?? files.find((f) => ['.dawproject', '.zip'].includes(ext(f.name)))
  if (!main) return null
  let x: XProject
  let skipped = 0
  let entries = new Map<string, Blob>()
  if (ext(main.name) === '.rpp') {
    const r = readRpp(await main.text())
    x = r.project
    skipped = r.notes.skippedItems
  } else {
    entries = await readZip(main)
    const xml = entries.get('project.xml')
    const rpp = [...entries.keys()].find((k) => ext(k) === '.rpp')
    if (xml) {
      const r = readDawproject(await xml.text())
      x = r.project
      skipped = r.notes.skippedClips
    } else if (rpp) {
      const r = readRpp(await entries.get(rpp)!.text())
      x = r.project
      skipped = r.notes.skippedItems
      // .rpp の置き場所からの相対のパスにする
      const dir = rpp.includes('/') ? rpp.slice(0, rpp.lastIndexOf('/') + 1) : ''
      if (dir) entries = new Map([...entries].map(([k, v]) => [k.startsWith(dir) ? k.slice(dir.length) : k, v]))
    } else return null
  }

  // 音声を探す（パスがそのままあるもの、なければ同じ名前のもの）
  const byName = new Map<string, Blob>()
  for (const [k, v] of entries) byName.set(baseName(k).toLowerCase(), v)
  for (const f of files) if (f !== main) byName.set(f.name.toLowerCase(), f)
  const audio = new Map<string, Clip>()
  const paths = new Set(x.tracks.flatMap((t) => t.clips.map((c) => c.file)))
  for (const path of paths) {
    const blob = entries.get(path.replace(/\\/g, '/')) ?? byName.get(baseName(path).toLowerCase())
    if (!blob) continue
    try {
      audio.set(path, await decodeFile(blob instanceof File ? blob : new File([blob], baseName(path))))
    } catch (e) {
      console.warn('Failed to decode audio for DAW import', { path, error: e })
    }
  }
  const { project, missing } = fromExchange(x, audio)
  return { project, name: main.name.replace(/\.[^.]+$/, ''), missing, skipped }
}
