// 操作履歴の名前。変える前と後のプロジェクトを比べて、何をしたかを決める（呼び出す所ごとに名前を渡さずに済むように）
import type { MessageKey } from './i18n'
import type { Block, Project } from './project'

const changedKeys = (a: Block, b: Block) => (Object.keys(b) as (keyof Block)[]).filter((k) => a[k] !== b[k])

export function describeChange(before: Project, after: Project): MessageKey {
  if (after.sources.length > before.sources.length) return 'history.import'
  if (after.tracks.length > before.tracks.length) return 'history.addTrack'
  if (after.tracks.length < before.tracks.length) return 'history.removeTrack'
  if (after.markers !== before.markers) return 'history.marker'
  if (after.tempo !== before.tempo) return 'history.tempo'
  if (after.master !== before.master) return 'history.master'
  if (after.tracks !== before.tracks) return 'history.track'
  if (after.blocks.length > before.blocks.length) return before.blocks.every((b) => after.blocks.some((x) => x.id === b.id)) ? 'history.paste' : 'history.split'
  if (after.blocks.length < before.blocks.length) return 'history.delete'
  const keys = new Set<keyof Block>()
  for (const b of after.blocks) {
    const old = before.blocks.find((x) => x.id === b.id)
    if (old && old !== b) for (const k of changedKeys(old, b)) keys.add(k)
  }
  if (keys.has('pitch') || keys.has('formant') || keys.has('algorithm')) return 'history.pitch'
  if (keys.has('envelope')) return 'history.envelope'
  if (keys.has('rate')) return 'history.rate'
  if (keys.has('offset') || keys.has('length')) return 'history.trim'
  if (keys.has('fadeIn') || keys.has('fadeOut')) return 'history.fade'
  if (keys.has('start') || keys.has('track')) return 'history.move'
  return 'history.block'
}
