// 時間のかかる、波形ブロックとトラックの確定（現在の音にして置き換える）と、トラックのフリーズ（書き出した音で鳴らす）。進み具合は PevenMUI のジョブで見せ、取り消せる
import { startJob } from 'pevenmui'
import { applyBaked, bakeBlocks } from './bake'
import { freezeTrack, unfreezeTrack } from './freeze'
import type { useT } from './i18n'
import type { useProject } from './useProject'

export function useBlockJobs({ doc, t, fail, notify }: { doc: ReturnType<typeof useProject>; t: ReturnType<typeof useT>; fail: (e: unknown) => void; notify: (message: string) => void }) {
  const { project } = doc
  /** 選んだ波形ブロックを確定する（今の音にして、元の音を置き換える） */
  const bake = async (ids: string[]) => {
    const controller = new AbortController()
    const job = startJob('bake', t('bake.job'), () => controller.abort())
    try {
      const baked = await bakeBlocks(doc.project, ids, (v) => job.update(v), 'all', controller.signal)
      doc.apply((pr) => applyBaked(pr, baked))
      notify(t('toast.baked'))
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) fail(e)
    } finally {
      job.end()
    }
  }
  /** トラックのフリーズと解除（src/freeze.ts） */
  const freeze = async (id: string, withFx = false) => {
    if (project.tracks.find((tr) => tr.id === id)?.frozen) return doc.apply((pr) => unfreezeTrack(pr, id))
    const controller = new AbortController()
    const job = startJob('freeze', t('freeze.job'), () => controller.abort())
    try {
      const frozen = await freezeTrack(doc.project, id, withFx, controller.signal)
      const f = frozen.tracks.find((tr) => tr.id === id)?.frozen
      const src = f && frozen.sources.find((s) => s.id === f.source)
      // 描画している間の変更は残し、書き出した音とトラックの印だけを足す
      if (f && src) doc.apply((pr) => (pr.tracks.some((tr) => tr.id === id) ? { ...pr, sources: [...pr.sources, src], tracks: pr.tracks.map((tr) => (tr.id === id ? { ...tr, frozen: f } : tr)) } : pr))
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) fail(e)
    } finally {
      job.end()
    }
  }
  return { bake, freeze }
}
