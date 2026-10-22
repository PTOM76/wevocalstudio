// 解析の欄のピッチの道具（平らにする、音程にそろえる、ビブラート、MIDI の当てはめ）。計算とダイアログは wevocal-lib（WeVocalSynth と同じ）。結果は波形ブロックのピッチカーブにする
import { useState } from 'react'
import { faFileAudio, faGripLines, faMagnet, faWaveSquare } from '@fortawesome/free-solid-svg-icons'
import { addVibrato, fitMidi, flattenPitch, snapPitch, type Range } from 'wevocal-lib'
import { MidiDialog, PitchToolText, SnapDialog, VibratoDialog } from 'wevocal-lib/react'
import { useT } from './i18n'
import { applyPitchTool, type PitchTool } from './pitchCurveTools'
import type { Block, PitchCurve } from './project'
import { ToolButton } from './Toolbar'

export default function PitchToolBar(p: {
  block: Block | null
  /** 元の音の F0（解析の欄が解析したもの。まだなら null） */
  f0: { data: Float32Array; hopSec: number } | null
  range: Range | null
  bpm: number
  /** 「平らにする」の強さ（設定。1 で揺れを取り除く） */
  flattenStrength: number
  onCurve: (curve: PitchCurve, merge: string) => void
}) {
  const t = useT()
  const [open, setOpen] = useState<'snap' | 'vibrato' | 'midi' | null>(null)
  const [count, setCount] = useState(0)
  const off = !p.block || !p.f0
  // 範囲が波形ブロックにかかっていれば、その中だけに掛ける
  const hasSelection = !!p.range && !!p.block && p.range.end > p.block.start && p.range.start < p.block.start + p.block.length
  const run = (tool: PitchTool) => {
    if (!p.block || !p.f0) return
    p.onCurve(applyPitchTool(p.block, p.f0.data, p.f0.hopSec, p.range, tool), `tool${count}`)
    setCount((n) => n + 1)
  }
  const close = () => setOpen(null)
  return (
    <PitchToolText.Provider value={t}>
      <ToolButton icon={faGripLines} label="pitchTool.flatten" disabled={off} onClick={() => run((cur, f0, k0, k1) => flattenPitch(cur, f0, k0, k1, p.flattenStrength))} />
      <ToolButton icon={faMagnet} label="snap.title" disabled={off} onClick={() => setOpen('snap')} />
      <ToolButton icon={faWaveSquare} label="vibrato.title" disabled={off} onClick={() => setOpen('vibrato')} />
      <ToolButton icon={faFileAudio} label="midi.title" disabled={off} onClick={() => setOpen('midi')} />
      <SnapDialog open={open === 'snap'} hasSelection={hasSelection} onClose={close} onRun={(o) => run((cur, f0, k0, k1) => snapPitch(cur, f0, k0, k1, o))} />
      <VibratoDialog open={open === 'vibrato'} hasSelection={hasSelection} bpm={p.bpm} onClose={close} onRun={(o) => run((cur, f0, k0, k1) => addVibrato(cur, f0, k0, k1, o))} />
      {/* MIDI の先頭は波形ブロックの頭に置く（秒は元の音の頭から） */}
      <MidiDialog open={open === 'midi'} hasSelection={hasSelection} bpm={p.bpm} defaultOffset={0} onClose={close} onRun={(o) => run((cur, f0, k0, k1) => fitMidi(cur, f0, k0, k1, o))} />
    </PitchToolText.Provider>
  )
}
