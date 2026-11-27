// プロジェクトを DAWproject（.dawproject。project.xml、metadata.xml、音声の zip）に書き出す（memo/daw-exchange.md）
import { APP_INFO } from '../appInfo'
import type { Project } from '../project'
import { createZip } from 'pevenmui/web'
import { writeDawproject, writeMetadata } from './dawproject'
import { toExchange, type ExchangeBlocks } from './exchange'

export async function exportDawproject(p: Project, fileName: string, mode: ExchangeBlocks, onProgress?: (v: number) => void, signal?: AbortSignal): Promise<Blob> {
  // DAWproject のクリップには音量が無いので、音量を変えたブロックは描画する
  const project = await toExchange(p, mode, { clipGain: false }, onProgress, signal)
  signal?.throwIfAborted()
  const xml = (s: string) => new Blob([s], { type: 'application/xml' })
  return createZip([
    { name: 'project.xml', data: xml(writeDawproject(project, { name: APP_INFO.name, version: __APP_VERSION__ })) },
    { name: 'metadata.xml', data: xml(writeMetadata(fileName)) },
    ...[...project.files].map(([name, data]) => ({ name, data })),
  ])
}
