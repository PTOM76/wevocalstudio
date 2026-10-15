// トラックのフリーズ。トラックの波形ブロックの音（ピッチ、速度、音量、フェード、エンベロープ）を書き出して普通の音声として鳴らし、ピッチなどの処理を止める。
// 音量、パン、FX、位相の反転、サブトラックは書き出さない（フリーズ中も変えられる）。元の波形ブロックは残し、解除すれば戻る
import { renderMix } from './engine'
import { newId, newProject, newTrack, type Project, type Track } from './project'

/** トラックの波形ブロックだけを、フェーダーの前の音にする。頭は最初の波形ブロックの位置から */
export async function freezeTrack(p: Project, trackId: string): Promise<Project> {
  const blocks = p.blocks.filter((b) => b.track === trackId)
  const track = p.tracks.find((t) => t.id === trackId)
  if (!track || !blocks.length) return p
  const start = Math.min(...blocks.map((b) => b.start))
  const end = Math.max(...blocks.map((b) => b.start + b.length))
  // 音量 0 dB、パンは中央、FX なしの 1 本だけのプロジェクトにして描画する
  const solo = newTrack(1)
  const q: Project = { ...newProject(), sources: p.sources, tracks: [solo], blocks: blocks.map((b) => ({ ...b, track: solo.id, start: b.start - start })) }
  const clip = await renderMix(q, end - start)
  const source = { id: newId(), name: `${track.name} (freeze)`, clip, duration: clip.channels[0].length / clip.sampleRate }
  return applyFreeze(p, trackId, source, start)
}

/** 描画した音をトラックに付ける（描画の間にトラックが消えていれば何もしない） */
function applyFreeze(p: Project, trackId: string, source: Project['sources'][number], start: number): Project {
  if (!p.tracks.some((t) => t.id === trackId)) return p
  return {
    ...p,
    sources: [...p.sources, source],
    tracks: p.tracks.map((t) => (t.id === trackId ? { ...t, frozen: { source: source.id, start } } : t)),
  }
}

/** フリーズを解除する（書き出した音は、ほかで使っていなければ消す） */
export function unfreezeTrack(p: Project, trackId: string): Project {
  const track = p.tracks.find((t) => t.id === trackId)
  if (!track?.frozen) return p
  const id = track.frozen.source
  const tracks = p.tracks.map((t): Track => (t.id === trackId ? { ...t, frozen: undefined } : t))
  const used = p.blocks.some((b) => b.source === id) || tracks.some((t) => t.frozen?.source === id)
  return { ...p, tracks, sources: used ? p.sources : p.sources.filter((s) => s.id !== id) }
}

/**
 * フリーズ中のトラックの波形ブロックは変えない（変更を前の状態に戻す）。
 * 前後の両方でフリーズしているトラックだけを守る（フリーズ、解除、トラックの複製や削除はそのまま通す）
 */
export function keepFrozen(prev: Project, next: Project): Project {
  if (prev === next) return next
  const frozen = new Set(next.tracks.filter((t) => t.frozen && prev.tracks.find((x) => x.id === t.id)?.frozen?.source === t.frozen.source).map((t) => t.id))
  if (!frozen.size) return next
  const prevById = new Map(prev.blocks.map((b) => [b.id, b]))
  const nextIds = new Set(next.blocks.map((b) => b.id))
  let changed = false
  const blocks = []
  for (const b of next.blocks) {
    const old = prevById.get(b.id)
    if (old && frozen.has(old.track)) {
      // フリーズ中のトラックにあった波形ブロックは前のまま
      blocks.push(old)
      changed ||= old !== b
    } else if (frozen.has(b.track)) {
      // フリーズ中のトラックへ移した、足したものは戻す
      if (old) blocks.push(old)
      changed = true
    } else blocks.push(b)
  }
  // フリーズ中のトラックから消したものは戻す
  for (const o of prev.blocks)
    if (frozen.has(o.track) && !nextIds.has(o.id)) {
      blocks.push(o)
      changed = true
    }
  return changed ? { ...next, blocks } : next
}
