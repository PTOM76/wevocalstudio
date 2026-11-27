// プロジェクトを REAPER のプロジェクト（.rpp）と音声ファイルにして、zip にまとめる（memo/daw-exchange.md）
import { createZip } from 'pevenmui/web'
import type { Project } from '../project'
import { toExchange, type ExchangeBlocks } from './exchange'
import { writeRpp } from './rpp'

/** fx なら FX の列も書く（VST と、ReaEQ に変える組み込みの EQ）。skippedFx は書けなかった FX の数 */
export async function exportRpp(p: Project, fileName: string, mode: ExchangeBlocks, fx: boolean, onProgress?: (v: number) => void, signal?: AbortSignal): Promise<{ zip: Blob; skippedFx: number }> {
  const project = await toExchange(p, mode, { clipGain: true, fx }, onProgress, signal)
  signal?.throwIfAborted()
  const entries = [{ name: `${fileName}.rpp`, data: new Blob([writeRpp(project)], { type: 'text/plain' }) }, ...[...project.files].map(([name, data]) => ({ name, data }))]
  return { zip: await createZip(entries), skippedFx: project.skippedFx ?? 0 }
}
