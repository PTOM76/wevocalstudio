// 先を走る方式で、FX の列のどこまでを Worker で掛けるか（memo/anticipate-stream.md）。再生のノード（graph.ts）からも使うので、Worker の読み込みを含まない小さなファイルにする
import { externalPackage, findPlugin, type FxSlot } from 'wevocal-lib'
import { liveSlots, type Track } from '../project'

/** Worker で動かせる FX の項目か（外から足した wevocal の processor と VST。WAM は Worker で動かせない。組み込みの FX はノードなので対象外） */
export function workerPackage(s: FxSlot) {
  const pkg = externalPackage(findPlugin(s.plugin))
  const format = pkg?.manifest.format
  return pkg && (format === 'wevocal' || format === 'vst') && pkg.processor && !s.sidechain ? pkg : null
}

/** FX の列の先頭から続く、Worker で動かせる項目の数。そこまでを Worker で先に計算し、残り（組み込みの FX など）はノードで掛ける */
export const streamPrefix = (t: Track) => {
  const slots = liveSlots(t)
  const i = slots.findIndex((s) => !workerPackage(s))
  return i < 0 ? slots.length : i
}
