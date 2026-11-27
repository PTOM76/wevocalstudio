// プロジェクトを REAPER のプロジェクト（.rpp）と音声ファイルにして、zip にまとめる（memo/daw-exchange.md）
import { createZip } from 'pevenmui/web'
import type { Project } from '../project'
import { toExchange, type ExchangeBlocks } from './exchange'
import { writeRpp } from './rpp'

export async function exportRpp(p: Project, fileName: string, mode: ExchangeBlocks, onProgress?: (v: number) => void, signal?: AbortSignal): Promise<Blob> {
  const project = await toExchange(p, mode, onProgress, signal)
  signal?.throwIfAborted()
  const entries = [{ name: `${fileName}.rpp`, data: new Blob([writeRpp(project)], { type: 'text/plain' }) }, ...[...project.files].map(([name, data]) => ({ name, data }))]
  return createZip(entries)
}
