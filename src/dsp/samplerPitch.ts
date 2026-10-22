// サンプラーの「フォルマントを保持」。音符の高さごとに、元の音を波形ブロックと同じピッチ処理（フォルマントを保つ方式）で作るための、見えない波形ブロックを決める。画面を知らない
import { findInstrument } from 'wevocal-lib'
import { newBlock, type Block, type InstrumentSlot, type Project } from '../project'

/** 見えない波形ブロックに使う処理方式（音の種類を選ばない） */
const DEFAULTS = { algorithm: 'wsola', preserveFormant: true } as const
/** 元の音の高さとの差の上限（半音）。これより離れる音は、速度を変えて鳴らす */
const MAX_SHIFT = 48

export interface SamplerShift {
  track: string
  /** 音符の高さ */
  pitch: number
  /** 元の音（高さを変える前）から作るための、見えない波形ブロック */
  block: Block
}

/** フォルマントを保持するサンプラーか（音源のつまみ「フォルマントを保持」がオンで、音色の元の音がある） */
const keeps = (spec: InstrumentSlot | undefined) => !!spec && spec.values.formant >= 0.5 && !!findInstrument(spec.plugin)?.sample && !!spec.sample

const cache = new WeakMap<Project, SamplerShift[]>()

/** プロジェクトの、サンプラーのフォルマント保持で作る音の一覧（トラックの MIDI ブロックの音符の高さごと。元の音の高さと同じ高さは速度を変えないので要らない） */
export function samplerShifts(p: Project): SamplerShift[] {
  let out = cache.get(p)
  if (out) return out
  out = []
  for (const track of p.tracks) {
    const spec = track.instrument
    const source = keeps(spec) ? p.sources.find((s) => s.id === spec!.sample) : undefined
    if (!spec || !source) continue
    const root = spec.values.root ?? 60
    const pitches = new Set((p.midi ?? []).filter((b) => b.track === track.id).flatMap((b) => b.notes.map((n) => n.pitch)))
    for (const pitch of [...pitches].sort((a, b) => a - b)) {
      const semis = pitch - root
      if (semis === 0 || Math.abs(semis) > MAX_SHIFT) continue
      out.push({ track: track.id, pitch, block: { ...newBlock(track.id, source, 0, DEFAULTS), id: `sampler:${track.id}:${pitch}`, pitch: semis } })
    }
  }
  cache.set(p, out)
  return out
}

/** 作る音の見えない波形ブロック（ピッチ処理に渡す） */
export const samplerBlocks = (p: Project): Block[] => samplerShifts(p).map((s) => s.block)
