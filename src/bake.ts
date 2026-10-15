// 波形ブロックの確定（今の速度、ピッチ、音量、フェード、エンベロープを音にして、新しい元の音に置き換える）
import { renderMix } from './engine'
import { newId, newProject, newTrack, type Block, type Project, type Source } from './project'

/** 確定する範囲。pitch はピッチと速度（フォルマント、ピッチカーブ、ピッチのエンベロープを含む）だけ。all は音量、フェード、エンベロープも */
export type BakeMode = 'pitch' | 'all'

/** 確定しても音が変わらない（その範囲の加工がない）か */
export function isNeutral(b: Block, mode: BakeMode): boolean {
  const pitchFree = b.rate === 1 && b.pitch === 0 && b.formant === 0 && !b.curve && !b.pitchEnvelope?.length
  return mode === 'pitch' ? pitchFree : pitchFree && b.gain === 0 && b.fadeIn === 0 && b.fadeOut === 0 && !b.envelope?.length
}

/** 確定した音（ブロックの id と、その音） */
export interface Baked {
  block: string
  source: Source
}

/** 波形ブロック 1 つだけを鳴らしたときの音をつくる（トラックの音量やパンは掛けない。ブロックの長さちょうど） */
async function bakeOne(p: Project, b: Block, mode: BakeMode): Promise<Baked> {
  const track = newTrack(1)
  const solo: Project = { ...newProject(), sources: p.sources, tracks: [track], blocks: [{ ...b, track: track.id, start: 0, mute: false, ...(mode === 'pitch' ? { gain: 0, fadeIn: 0, fadeOut: 0, envelope: undefined } : {}) }] }
  const clip = await renderMix(solo, b.length)
  const name = p.sources.find((s) => s.id === b.source)?.name.replace(/\.[^.]+$/, '') ?? ''
  return { block: b.id, source: { id: newId(), name, clip, duration: clip.channels[0].length / clip.sampleRate } }
}

/** 選んだ波形ブロックを順に確定する（onProgress は 0〜1）。確定する範囲に加工がないものは、音が変わらないので飛ばす */
export async function bakeBlocks(p: Project, ids: string[], onProgress: (v: number) => void, mode: BakeMode = 'all'): Promise<Baked[]> {
  const blocks = p.blocks.filter((b) => ids.includes(b.id) && (mode === 'all' || !isNeutral(b, mode)))
  const out: Baked[] = []
  for (const b of blocks) {
    out.push(await bakeOne(p, b, mode))
    onProgress(out.length / blocks.length)
  }
  return out
}

/** 確定した音を元の音にして、波形ブロックを加工なし（速度 1、ピッチ 0 など）にする。位置と長さと、ミュートは残す */
export function applyBaked(p: Project, baked: Baked[], mode: BakeMode = 'all'): Project {
  const byBlock = new Map(baked.map((x) => [x.block, x.source]))
  return {
    ...p,
    sources: [...p.sources, ...baked.filter((x) => p.blocks.some((b) => b.id === x.block)).map((x) => x.source)],
    blocks: p.blocks.map((b) => {
      const source = byBlock.get(b.id)
      if (!source) return b
      const pitchFree = { source: source.id, offset: 0, length: Math.min(b.length, source.duration), rate: 1, pitch: 0, formant: 0, curve: undefined, pitchEnvelope: undefined }
      // ピッチと速度だけ確定したときは、音量、フェード、エンベロープは波形ブロックに残す（あとから変えられる）
      return mode === 'pitch' ? { ...b, ...pitchFree } : { ...b, ...pitchFree, gain: 0, fadeIn: 0, fadeOut: 0, envelope: undefined }
    }),
  }
}
