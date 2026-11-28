// プロジェクトを DAWproject（.dawproject。project.xml、metadata.xml、音声の zip）に書き出す（memo/daw-exchange.md）
import { APP_INFO } from '../appInfo'
import type { Project } from '../project'
import { createZip } from 'pevenmui/web'
import { writeDawproject, writeMetadata } from './dawproject'
import { toExchange, type ExchangeBlocks } from './exchange'

/** fx なら VST（VST2、VST3）も書く。skippedFx は書けなかった FX の数 */
export async function exportDawproject(p: Project, fileName: string, mode: ExchangeBlocks, fx: boolean, onProgress?: (v: number) => void, signal?: AbortSignal): Promise<{ zip: Blob; skippedFx: number }> {
  // DAWproject のクリップには音量が無いので、音量を変えたブロックは描画する
  const project = await toExchange(p, mode, { clipGain: false, fx, daw: 'dawproject' }, onProgress, signal)
  signal?.throwIfAborted()
  const xml = (s: string) => new Blob([s], { type: 'application/xml' })
  // 書くと project.files にプリセットのファイルが足されるので、先に書く
  const projectXml = writeDawproject(project, { name: APP_INFO.name, version: __APP_VERSION__ })
  const zip = await createZip([
    { name: 'project.xml', data: xml(projectXml) },
    { name: 'metadata.xml', data: xml(writeMetadata(fileName)) },
    ...[...project.files].map(([name, data]) => ({ name, data })),
  ])
  return { zip, skippedFx: project.skippedFx ?? 0 }
}
