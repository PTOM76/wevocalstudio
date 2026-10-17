// トラックのフリーズ。トラックの波形ブロックの音（ピッチ、速度、音量、フェード、エンベロープ）を書き出して普通の音声として鳴らし、ピッチなどの処理を止める。
// 音量、パン、位相の反転、サブトラックは書き出さない（フリーズ中も変えられる）。FX は withFx のときだけ含める（重い VST などを確定する）。元の波形ブロックは残し、解除すれば戻る
import { chainLatency, chainTail } from 'wevocal-lib'
import { renderMix } from './engine'
import { newId, newProject, newTrack, type Project, type Track } from './project'

/** トラックの波形ブロックだけを、フェーダーの前の音にする（withFx なら FX の列の後の音）。頭は最初の波形ブロックの位置から */
export async function freezeTrack(p: Project, trackId: string, withFx = false): Promise<Project> {
  const blocks = p.blocks.filter((b) => b.track === trackId)
  const track = p.tracks.find((t) => t.id === trackId)
  if (!track || !blocks.length) return p
  const start = Math.min(...blocks.map((b) => b.start))
  const fx = withFx ? (track.fx ?? []) : []
  // FX の余韻（リバーブなど）の分だけ後ろを延ばす
  const end = Math.max(...blocks.map((b) => b.start + b.length)) + (withFx ? chainTail(fx, p.tempo.bpm) : 0)
  // 音量 0 dB、パンは中央の 1 本だけのプロジェクトにして描画する（FX は withFx のときだけ）
  const solo = { ...newTrack(1), fx }
  const q: Project = { ...newProject(), tempo: p.tempo, sources: p.sources, tracks: [solo], blocks: blocks.map((b) => ({ ...b, track: solo.id, start: b.start - start })) }
  const rendered = await renderMix(q, end - start)
  // FX の遅れの分は頭を削る（フリーズ中は FX の遅れがないものとして鳴らす）
  const skip = Math.round(chainLatency(fx, rendered.sampleRate) * rendered.sampleRate)
  const clip = skip ? { ...rendered, channels: rendered.channels.map((c) => c.slice(skip)) } : rendered
  const source = { id: newId(), name: `${track.name} (freeze)`, clip, duration: clip.channels[0].length / clip.sampleRate }
  return applyFreeze(p, trackId, source, start, withFx)
}

/** 描画した音をトラックに付ける（描画の間にトラックが消えていれば何もしない） */
function applyFreeze(p: Project, trackId: string, source: Project['sources'][number], start: number, fx: boolean): Project {
  if (!p.tracks.some((t) => t.id === trackId)) return p
  return {
    ...p,
    sources: [...p.sources, source],
    tracks: p.tracks.map((t) => (t.id === trackId ? { ...t, frozen: { source: source.id, start, ...(fx ? { fx: true } : {}) } } : t)),
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
 * フリーズ中のトラックの波形ブロック（FX まで含めたときは FX の列も）は変えない（変更を前の状態に戻す）。
 * 前後の両方でフリーズしているトラックだけを守る（フリーズ、解除、トラックの複製や削除はそのまま通す）
 */
export function keepFrozen(prev: Project, next: Project): Project {
  if (prev === next) return next
  const frozen = new Set(next.tracks.filter((t) => t.frozen && prev.tracks.find((x) => x.id === t.id)?.frozen?.source === t.frozen.source).map((t) => t.id))
  if (!frozen.size) return next
  next = keepFrozenFx(prev, next, frozen)
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

/** FX まで含めてフリーズしたトラックの FX の列を前のままにする */
function keepFrozenFx(prev: Project, next: Project, frozen: Set<string>): Project {
  let changed = false
  const tracks = next.tracks.map((t) => {
    const old = prev.tracks.find((x) => x.id === t.id)
    if (!frozen.has(t.id) || !t.frozen?.fx || !old || old.fx === t.fx) return t
    changed = true
    return { ...t, fx: old.fx }
  })
  return changed ? { ...next, tracks } : next
}
