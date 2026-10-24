// テンポの解析（選んだ波形ブロックから。WeVocalSynth と同じ解析）と、BPM、1 拍目の位置の設定
import { useState } from 'react'
import type { TempoCandidate } from 'pevenmui'
import { detectTempoChanges, type Clip, type TempoChangeSection, type TempoChangeSensitivity } from 'wevocal-lib'
import { analyzeTempo } from './dsp/pitch'
import { useT } from './i18n'
import type { Project, Tempo } from './project'

/** 全チャンネルを平均したモノラルの音 */
function mixDown(channels: Float32Array[]) {
  const mono = new Float32Array(channels[0]?.length ?? 0)
  for (const ch of channels) for (let i = 0; i < mono.length; i++) mono[i] += ch[i] / channels.length
  return mono
}

/** 区間のテンポの解析（途中の変化を探すときに wevocal-lib へ渡す） */
const analyzeChannels = (channels: Float32Array[], sampleRate: number) => analyzeTempo(mixDown(channels), sampleRate)

export function useTempoDetect(o: { project: Project; selected: string[]; updateTempo: (patch: Partial<Tempo>) => void; fail: (e: unknown) => void; notify: (m: string) => void; tempoChange: TempoChangeSensitivity; onTempoChanges: (sections: TempoChangeSection[]) => void }) {
  const t = useT()
  const { project, selected, fail } = o
  const sourceOf = (id: string | undefined) => project.sources.find((s) => s.id === id)
  const doc = { updateTempo: o.updateTempo }
  const setNotice = o.notify
  /** 選んだ波形ブロック（なければ最初のもの）からテンポを解析して、プロジェクトのテンポにする（WeVocalSynth と同じ解析） */
  const [tempoCandidates, setTempoCandidates] = useState<TempoCandidate[]>([])
  const [analyzingTempo, setAnalyzingTempo] = useState(false)
  /** BPM と 1 拍目の位置（秒）をプロジェクトのテンポにする */
  const setBpm = (bpm: number, first?: number) => {
    const beat = 60 / bpm
    doc.updateTempo(first === undefined ? { bpm } : { bpm, beatOffset: ((first % beat) + beat) % beat })
  }
  /** 読み込んだ音全体のテンポを解析して、プロジェクトのテンポにする（設定の自動解析。失敗しても通知しない）。設定によっては途中の変化も探し、見つけたら知らせる */
  const detectClip = async (clip: Clip) => {
    const [best] = await analyzeTempo(mixDown(clip.channels), clip.sampleRate).catch(() => [])
    if (!best) return
    const bpm = Math.round(best.bpm * 100) / 100
    setBpm(bpm, best.offset)
    setNotice(t('toast.tempo', { bpm }))
    const found = await detectTempoChanges(clip, best, o.tempoChange, analyzeChannels).catch(() => null)
    if (found) o.onTempoChanges(found)
  }
  const detect = async () => {
    const b = project.blocks.find((x) => selected.includes(x.id)) ?? project.blocks[0]
    const source = b && sourceOf(b.source)
    if (!b || !source) return
    setAnalyzingTempo(true)
    try {
      const { clip } = source
      const from = Math.floor(b.offset * clip.sampleRate)
      const to = Math.min(clip.channels[0].length, from + Math.floor(b.length * b.rate * clip.sampleRate))
      const mono = new Float32Array(to - from)
      for (const ch of clip.channels) for (let i = 0; i < mono.length; i++) mono[i] += ch[from + i] / clip.channels.length
      // 速度を変えた波形ブロックは、そのぶん BPM も変わる。1 拍目の位置はプロジェクトの時間にする
      const found = (await analyzeTempo(mono, clip.sampleRate)).map((c) => ({ bpm: Math.round(c.bpm * b.rate * 100) / 100, offset: b.start + c.offset / b.rate, strength: c.strength }))
      setTempoCandidates(found)
      const [best] = found
      if (!best) return fail(t('error.noTempo'))
      setBpm(best.bpm, best.offset)
      setNotice(t('toast.tempo', { bpm: best.bpm }))
    } catch (e) {
      fail(e)
    } finally {
      setAnalyzingTempo(false)
    }
  }


  return { candidates: tempoCandidates, analyzing: analyzingTempo, setBpm, detect, detectClip }
}
