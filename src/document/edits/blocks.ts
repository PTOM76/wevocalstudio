// 波形ブロックと MIDI ブロックを変える処理。プロジェクトを受け取って、新しいプロジェクトを返す純粋な関数（React を使わないので、そのまま試せる）
import { DEFAULT_SILENCE, findSounds } from 'wevocal-lib'
import { projectBeatMap } from '../../beats'
import { midiBlocks, newId, splitBlock, splitMidiBlock, type Block, type InstrumentSlot, type MidiBlock, type Project } from '../../project'

/** ピッチの範囲（半音）。大きく変えるときは wasm が 24 半音ずつに分けて処理する */
export const PITCH_MAX = 256

/** 波形ブロックと MIDI ブロックを消す */
export const removeBlocks = (p: Project, ids: string[]): Project => ({
  ...p,
  blocks: p.blocks.filter((b) => !ids.includes(b.id)),
  ...(p.midi ? { midi: p.midi.filter((b) => !ids.includes(b.id)) } : {}),
})

/** 波形ブロックをまとめて変える（id → 変える値） */
export const patchBlocks = (p: Project, patches: Record<string, Partial<Block>>): Project => ({
  ...p,
  blocks: p.blocks.map((b) => (patches[b.id] ? { ...b, ...patches[b.id] } : b)),
})

/** MIDI ブロックをまとめて変える（id → 変える値） */
export const patchMidiBlocks = (p: Project, patches: Record<string, Partial<MidiBlock>>): Project => ({
  ...p,
  midi: midiBlocks(p).map((b) => (patches[b.id] ? { ...b, ...patches[b.id] } : b)),
})

/** MIDI ブロックを足す */
export const addMidiBlocks = (p: Project, blocks: MidiBlock[]): Project => ({ ...p, midi: [...midiBlocks(p), ...blocks] })

/** トラックの time 秒に、2 小節の空の MIDI ブロック（id）を足す。音源がなければ instrument() で標準のものを付ける。トラックがなければそのまま */
export function addEmptyMidi(p: Project, id: string, trackId: string, time: number, instrument: () => InstrumentSlot): Project {
  const t = p.tracks.find((x) => x.id === trackId)
  if (!t) return p
  const length = (p.tempo.beatsPerBar * 60 * 2) / p.tempo.bpm
  const block: MidiBlock = { id, track: trackId, start: Math.max(0, time), length, unit: 'beat', notes: [], mute: false }
  return { ...p, tracks: p.tracks.map((x) => (x === t && !t.instrument ? { ...x, instrument: instrument() } : x)), midi: [...midiBlocks(p), block] }
}

/** 波形ブロックの写し（新しい id を付けたもの）を置く。元の音がもう無いものは置かない */
export const insertBlocks = (p: Project, copies: Block[]): Project => ({ ...p, blocks: [...p.blocks, ...copies.filter((b) => p.sources.some((s) => s.id === b.source))] })

/** ピッチを delta 半音だけ変える。delta が null なら 0 に戻す。小数の誤差は 0.01 半音（1 セント）に丸める */
export const nudgePitch = (p: Project, ids: string[], delta: number | null): Project => ({
  ...p,
  blocks: p.blocks.map((b) => (ids.includes(b.id) ? { ...b, pitch: delta === null ? 0 : Math.max(-PITCH_MAX, Math.min(PITCH_MAX, Math.round((b.pitch + delta) * 100) / 100)) } : b)),
})

/** 無音で区切り、音のある所だけを残す（WeVocalSynth の「無音で区切る」と同じ判定。-40dB、200ms） */
export const splitBySilence = (p: Project, ids: string[], defaultFade: number): Project => ({
  ...p,
  blocks: p.blocks.flatMap((b) => {
    const source = p.sources.find((s) => s.id === b.source)
    if (!ids.includes(b.id) || !source) return [b]
    const { clip } = source
    const from = Math.floor(b.offset * clip.sampleRate)
    const to = Math.min(clip.channels[0].length, from + Math.ceil(b.length * b.rate * clip.sampleRate))
    const part = { sampleRate: clip.sampleRate, channels: clip.channels.map((c) => c.subarray(from, to)) }
    const sounds = findSounds(part, DEFAULT_SILENCE)
    if (!sounds.length) return [b]
    // 範囲は元の音の上の秒。時間軸の上では速度で割る
    return sounds.map((r, i) => {
      const length = (r.end - r.start) / b.rate
      return { ...b, id: i ? newId() : b.id, start: b.start + r.start / b.rate, offset: b.offset + r.start, length, fadeIn: Math.min(defaultFade, length / 2), fadeOut: Math.min(defaultFade, length / 2) }
    })
  }),
})

/** 位置 t で分ける。ids が空なら、t にかかる波形ブロックと MIDI ブロックを全部分ける */
export const splitAt = (p: Project, t: number, ids: string[], defaultFade: number): Project => ({
  ...p,
  blocks: p.blocks.flatMap((b) => (ids.length && !ids.includes(b.id) ? [b] : (splitBlock(b, t, defaultFade) ?? [b]))),
  ...(p.midi ? { midi: p.midi.flatMap((b) => (ids.length && !ids.includes(b.id) ? [b] : (splitMidiBlock(b, t, projectBeatMap(p)) ?? [b]))) } : {}),
})
