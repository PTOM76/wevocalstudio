// ボーカル抽出と楽器ごとの分離、和音の分離（手順は extractor の host.ts。WeVocalSynth と共通）。選んだ波形ブロックの音を分けて、新しいトラックに並べる
import { startJob, useAddonInstall, useConfirm } from 'pevenmui'
import { isMobile } from 'pevenmui/web'
import type { Clip } from 'wevocal-lib'
import { splitVoices } from './dsp/pitch'
import { createHost, LEAD_MODEL, prepareExtract, resolveModel, STEM_MODELS, STEM_ORDER, VOCAL_MODELS, type ExtractOptions } from 'wevocalextractor/host'
import { addonFileUrl, installedManifest, loadAddon } from './addons'
import { useT, type MessageKey } from './i18n'
import type { Block, Project } from './project'
import type { Settings } from './settings/settings'
import type { useProject } from './useProject'

const host = createHost({ loadAddon: (id) => loadAddon(id), installedManifest, addonFileUrl, isMobile })

/** 波形ブロックが使っている元の音の範囲（分けるのはこの範囲だけ） */
export function segmentOf(p: Project, b: Block): Clip | null {
  const src = p.sources.find((s) => s.id === b.source)
  if (!src) return null
  const sr = src.clip.sampleRate
  const from = Math.max(0, Math.floor(b.offset * sr))
  const to = Math.min(src.clip.channels[0].length, from + Math.ceil(b.length * b.rate * sr))
  return { sampleRate: sr, channels: src.clip.channels.map((c) => c.slice(from, to)) }
}

export function useExtract(o: { doc: ReturnType<typeof useProject>; settings: Settings; fail: (e: unknown) => void; notify: (m: string) => void }) {
  const t = useT()
  const install = useAddonInstall()
  const { confirm, dialog: confirmDialog } = useConfirm()
  const s = o.settings
  // GPU で処理できなかったら、CPU で続けるかを尋ねる（WeVocalSynth と同じ）
  const confirmCpu = (reason: string) => confirm({ message: t('extract.gpuFallback', { reason }), okLabel: t('extract.gpuFallbackOk') })
  // この端末と非互換のモデルなら、代わりのモデルで抽出する（設定は変えない）
  const base = (): ExtractOptions => ({ model: resolveModel(s.vocalModel, s.vocalGpu).model, gpu: s.vocalGpu, keepHighBand: s.vocalKeepHighBand, memoryMb: s.vocalMemoryMb, threads: s.vocalThreads })
  const ui = { ensure: install.ensure, confirmCpu, noAdapter: t('extract.noAdapter') }

  /** 選んだ波形ブロックの音を `split` で分け、名前を付けて新しいトラックに並べる */
  const run = async (blockId: string, label: MessageKey, split: (c: Clip, onProgress: (p: number) => void) => Promise<[MessageKey, Float32Array[] | undefined][]>, done: MessageKey = 'toast.extracted') => {
    const p = o.doc.project
    const b = p.blocks.find((x) => x.id === blockId)
    const clip = b && segmentOf(p, b)
    if (!b || !clip) return
    const name = p.sources.find((x) => x.id === b.source)?.name.replace(/\.[^.]+$/, '') ?? ''
    // 進み具合はステータスバーのゲージに出す（WeVocalSynth と同じ startJob）
    const job = startJob('extract', t(label))
    try {
      const stems = await split(clip, (v) => job.update(v))
      o.doc.addStems(
        b.id,
        stems.flatMap(([key, ch]) => (ch ? [{ name: t(key, { name }), clip: { sampleRate: clip.sampleRate, channels: ch } }] : [])),
      )
      o.notify(t(done))
    } catch (e) {
      o.fail(e)
    } finally {
      job.end()
    }
  }

  return {
    /** ボーカルと伴奏に分ける関数を用意する（一音ずつ切り出しで、先にボーカルを取り出すとき。モデルを導入しなければ null） */
    prepareSeparate: async () => {
      const opts = await prepareExtract(base(), VOCAL_MODELS[base().model].addon, ui)
      return opts && ((c: Clip, onProgress: (p: number) => void, signal?: AbortSignal) => host.splitBoth(c.channels, c.sampleRate, opts, onProgress, signal, confirmCpu))
    },
    dialog: (
      <>
        {install.dialog}
        {confirmDialog}
      </>
    ),
    /** ボーカルと伴奏に分ける（推論は 1 回） */
    splitVocals: async (blockId: string) => {
      const opts = await prepareExtract(base(), VOCAL_MODELS[base().model].addon, ui)
      if (!opts) return
      await run(blockId, 'extract.split', async (c, onProgress) => {
        const r = await host.splitBoth(c.channels, c.sampleRate, opts, onProgress, undefined, confirmCpu)
        return [
          ['track.vocalsName', r.vocals],
          ['track.accompanimentName', r.accompaniment],
        ]
      })
    },
    /** 主旋律、ハモリ、伴奏に分ける（推論は 2 回） */
    splitLead: async (blockId: string) => {
      const opts = await prepareExtract(base(), VOCAL_MODELS[base().model].addon, ui)
      if (!opts || !(await prepareExtract({ ...base(), model: LEAD_MODEL }, VOCAL_MODELS[LEAD_MODEL].addon, ui))) return
      await run(blockId, 'extract.splitLead', async (c, onProgress) => {
        const r = await host.splitLead(c.channels, c.sampleRate, opts, onProgress, undefined, confirmCpu)
        return [
          ['track.leadName', r.lead],
          ['track.harmonyName', r.harmony],
          ['track.accompanimentName', r.accompaniment],
        ]
      })
    },
    /** 和音を 2 つの声（高い方と低い方、または大きい方と小さい方）に分ける（試験的。wevocal-lib の voices。足すと元の音になる） */
    splitVoices: (blockId: string, by: 'pitch' | 'volume') =>
      run(
        blockId,
        'task.splitVoices',
        async (c, onProgress) => {
          const r = await splitVoices(c.channels, c.sampleRate, by, onProgress)
          return by === 'pitch'
            ? [
                ['track.voiceHigh', r.a],
                ['track.voiceLow', r.b],
              ]
            : [
                ['track.voiceLoud', r.a],
                ['track.voiceQuiet', r.b],
              ]
        },
        'toast.voicesSplit',
      ),
    /** 楽器ごとに分ける（Demucs。設定でボーカルを主旋律とハモリにも分ける） */
    splitInstruments: async (blockId: string) => {
      const opts = await prepareExtract({ ...base(), stemModel: s.stemModel }, STEM_MODELS[s.stemModel].addon, ui)
      if (!opts) return
      if (s.stemChorus && !(await prepareExtract({ ...base(), model: LEAD_MODEL }, VOCAL_MODELS[LEAD_MODEL].addon, ui))) return
      await run(blockId, 'extract.splitInstruments', async (c, onProgress) => {
        const r = await host.splitInstruments(c.channels, c.sampleRate, opts, s.stemChorus, onProgress, undefined, confirmCpu)
        return STEM_ORDER.map(([k, key]) => [key, r[k]])
      })
    },
  }
}
