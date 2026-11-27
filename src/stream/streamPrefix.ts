// 先を走る方式で、FX の列のどこまでを Worker で掛けるか（memo/anticipate-stream.md）。再生のノード（graph.ts）からも使うので、Worker の読み込みを含まない小さなファイルにする
import { EQ_ID, EQ_PROCESSOR_NAME, EQ_PROCESSOR_SOURCE, externalPackage, findPlugin, readySnapshot, type FxSlot, type PluginManifest } from 'wevocal-lib'
import { processorName } from 'wevocal-lib/stream'
import { liveSlots, type Track } from '../project'

/** Worker で動かす FX（processor のソースと、プラグインごとに 1 回だけ送る大きいもの） */
export interface WorkerFx {
  /** プラグインを見分ける名前（ソースを送ったかの印） */
  key: string
  /** processor の名前（registerProcessor） */
  name: string
  source: string
  assets: () => Record<string, unknown>
  manifest: PluginManifest
}

/** Worker で動かせる FX の項目か。外から足した wevocal の processor と VST、組み込みの EQ（計算の processor がある）。WAM とほかの組み込みの FX はノードだけ */
export function workerFx(s: FxSlot): WorkerFx | null {
  if (s.sidechain) return null
  if (s.plugin === EQ_ID) {
    const manifest = findPlugin(EQ_ID)?.manifest
    return manifest ? { key: `${EQ_ID}@builtin`, name: EQ_PROCESSOR_NAME, source: EQ_PROCESSOR_SOURCE, assets: () => ({}), manifest } : null
  }
  const pkg = externalPackage(findPlugin(s.plugin))
  const format = pkg?.manifest.format
  if (!pkg || (format !== 'wevocal' && format !== 'vst') || !pkg.processor) return null
  return {
    key: `${pkg.manifest.id}@${pkg.manifest.version}`,
    name: processorName(pkg.manifest.id),
    source: pkg.processor,
    assets: () => ({ wasm: pkg.wasm, dll: pkg.dll, snap: format === 'vst' ? readySnapshot(pkg) : null }),
    manifest: pkg.manifest,
  }
}

/** 外から足した processor か VST か（組み込みの EQ だけの列は、ノードで十分なので先を走る方式にしない） */
export const isHeavyWorkerFx = (s: FxSlot) => !!workerFx(s) && s.plugin !== EQ_ID

/** FX の列の先頭から続く、Worker で動かせる項目の数。そこまでを Worker で先に計算し、残り（ほかの組み込みの FX など）はノードで掛ける */
export const streamPrefix = (t: Track) => {
  const slots = liveSlots(t)
  const i = slots.findIndex((s) => !workerFx(s))
  return i < 0 ? slots.length : i
}
