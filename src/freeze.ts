// トラックのフリーズ。トラックの波形ブロックの音（ピッチ、速度、音量、フェード、エンベロープ）を書き出して普通の音声として鳴らし、ピッチなどの処理を止める。
// サブトラックの音（それぞれの音量、パン、FX まで）と MIDI ブロックの音も含める。フリーズ中はサブトラックも鳴らさない（DAW のフォルダーのフリーズと同じ）。
// 自分の音量、パン、位相の反転は書き出さない（フリーズ中も変えられる）。自分の FX は withFx のときだけ含める（重い VST などを確定する）。元の波形ブロックは残し、解除すれば戻る
import { chainLatency, chainTail } from 'wevocal-lib'
import { renderMix } from './engine'
import { ancestors, descendants, frozenFxCount, liveSlots, newId, newProject, type Project, type Track, midiBlocks } from './project'

/** トラックとサブトラックの音を、自分のフェーダーの前の音にする（withFx なら自分の FX の列の後の音）。頭は最初のブロックの位置から */
export async function freezeTrack(p: Project, trackId: string, withFx = false, signal?: AbortSignal): Promise<Project> {
  const track = p.tracks.find((t) => t.id === trackId)
  if (!track) return p
  const subs = descendants(p, track)
  const ids = new Set([trackId, ...subs.map((t) => t.id)])
  const blocks = p.blocks.filter((b) => ids.has(b.track))
  const midi = midiBlocks(p).filter((b) => ids.has(b.track))
  const all = [...blocks, ...midi]
  if (!all.length) return p
  const start = Math.min(...all.map((b) => b.start))
  const fx = withFx ? (track.fx ?? []) : []
  // FX の余韻（リバーブなど）の分だけ後ろを延ばす（サブトラックの FX と、withFx なら自分の FX）
  const tail = Math.max(withFx ? chainTail(fx, p.tempo.bpm) : 0, ...subs.map((t) => chainTail(t.fx, p.tempo.bpm)))
  const end = Math.max(...all.map((b) => b.start + b.length)) + tail
  // 自分は音量 0 dB、パンは中央、FX は withFx のときだけ。サブトラックはそのまま（ソロは外し、木の外へのセンドは外す）
  const root: Track = { ...track, volume: 0, pan: 0, invert: false, mute: false, solo: false, parent: undefined, sends: [], autoLane: undefined, fx, frozen: undefined }
  const tracks = [root, ...subs.map((t): Track => ({ ...t, solo: false, sends: (t.sends ?? []).filter((s) => ids.has(s.to)) }))]
  // 時刻はずらさずに描く（オートメーションとテンポのマーカーを曲の時刻のまま使う）。頭の何もない所はあとで削る
  const q: Project = { ...newProject(), tempo: p.tempo, markers: p.markers, sources: p.sources, tracks, blocks, ...(midi.length ? { midi } : {}), end }
  const rendered = await renderMix(q, end, 48000, undefined, signal)
  signal?.throwIfAborted()
  // 最初のブロックより前と、FX の遅れの分は頭を削る（フリーズ中は FX の遅れがないものとして鳴らす）
  // 遅れは、描画で一番遅い道（サブトラックの FX から自分の FX まで）にそろえてある
  const sr = rendered.sampleRate
  const late = Math.max(...q.tracks.map((t) => [t, ...ancestors(q, t)].reduce((s, x) => s + chainLatency(liveSlots(x), sr), 0)))
  const skip = Math.round((start + late) * sr)
  const clip = skip ? { ...rendered, channels: rendered.channels.map((c) => c.slice(skip)) } : rendered
  const source = { id: newId(), name: `${track.name} (freeze)`, clip, duration: clip.channels[0].length / clip.sampleRate }
  return applyFreeze(p, trackId, source, start, withFx ? fx.length : null)
}

/** 描画した音をトラックに付ける（描画の間にトラックが消えていれば何もしない） */
function applyFreeze(p: Project, trackId: string, source: Project['sources'][number], start: number, fxCount: number | null): Project {
  if (!p.tracks.some((t) => t.id === trackId)) return p
  return {
    ...p,
    sources: [...p.sources, source],
    tracks: p.tracks.map((t) => (t.id === trackId ? { ...t, frozen: { source: source.id, start, ...(fxCount !== null ? { fx: true, fxCount } : {}) } } : t)),
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
  const roots = new Set(next.tracks.filter((t) => t.frozen && prev.tracks.find((x) => x.id === t.id)?.frozen?.source === t.frozen.source).map((t) => t.id))
  if (!roots.size) return next
  next = keepFrozenFx(prev, next, roots)
  // サブトラックの音も書き出してあるので、サブトラックの波形ブロックも守る
  const frozen = new Set([...roots, ...next.tracks.filter((t) => ancestors(next, t).some((a) => roots.has(a.id))).map((t) => t.id)])
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

/** FX まで含めてフリーズしたトラックの、音に含めた FX（列の先頭）を前のままにする。後ろに足した FX はそのまま通す */
function keepFrozenFx(prev: Project, next: Project, frozen: Set<string>): Project {
  let changed = false
  const tracks = next.tracks.map((t) => {
    const old = prev.tracks.find((x) => x.id === t.id)
    if (!frozen.has(t.id) || !t.frozen?.fx || !old || old.fx === t.fx) return t
    const n = frozenFxCount(old)
    const keep = (old.fx ?? []).slice(0, n)
    const fx = t.fx ?? []
    // 先頭が前と同じで、個数も記録してあれば、そのまま
    if (t.frozen.fxCount === n && keep.every((s, i) => fx[i] === s)) return t
    changed = true
    // 音に含めた FX を先頭に戻し、ほかは後ろに付ける（個数を記録していない古いものは、ここで記録する）
    return { ...t, fx: [...keep, ...fx.slice(n)], frozen: { ...t.frozen, fxCount: n } }
  })
  return changed ? { ...next, tracks } : next
}
