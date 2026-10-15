// 選んだ波形ブロックを MIDI の音符に並べる（音符ごとに波形ブロックを写し、高さはピッチ、長さは合わせ方で決める。音は処理しないので、あとから直せる）
import type { FitMode, SamplerNote } from 'wevocal-lib'
import { RATE_MAX, RATE_MIN, newId, newTrack, type Block, type Project } from './project'

/** 音符の長さに合わせた波形ブロック（伸縮は速度、繰り返しは並べる、そのままは長ければ切る） */
function fitBlocks(b: Block, start: number, dur: number, fit: FitMode): Block[] {
  if (fit === 'stretch') {
    const rate = Math.min(RATE_MAX, Math.max(RATE_MIN, (b.length * b.rate) / dur))
    return [{ ...b, start, rate, length: Math.min(dur, (b.length * b.rate) / rate) }]
  }
  if (fit === 'cut') return [{ ...b, start, length: Math.min(b.length, dur) }]
  // 繰り返す: 音符の終わりまで並べ、最後は切る
  const out: Block[] = []
  for (let at = 0; at < dur - 1e-3; at += b.length) out.push({ ...b, id: newId(), start: start + at, length: Math.min(b.length, dur - at) })
  return out
}

/**
 * `block` を `notes` の位置へ、その高さと長さで並べた新しいトラックを、元のトラックのすぐ下に足す。
 * `at` は音符の 0 秒を置く位置、`baseNote` は元の音の音程（音符との差だけピッチを変える）
 */
export function placeOnNotes(p: Project, blockId: string, notes: SamplerNote[], baseNote: number, fit: FitMode, at: number, name: string): Project {
  const b = p.blocks.find((x) => x.id === blockId)
  if (!b || !notes.length) return p
  const track = { ...newTrack(0), name, parent: p.tracks.find((tr) => tr.id === b.track)?.parent }
  const index = p.tracks.findIndex((tr) => tr.id === b.track)
  const blocks = notes.flatMap((n) => fitBlocks({ ...b, id: newId(), track: track.id, pitch: b.pitch + n.note - baseNote }, at + n.start, Math.max(0.01, n.end - n.start), fit))
  return { ...p, tracks: [...p.tracks.slice(0, index + 1), track, ...p.tracks.slice(index + 1)], blocks: [...p.blocks, ...blocks] }
}
