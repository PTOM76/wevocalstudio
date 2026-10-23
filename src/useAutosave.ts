// 起動時に前回の作業（開いていたタブすべて）を戻し、変わったら少し待って書く（WeVocalSynth と同じ。書き込みは Worker）
import { useEffect } from 'react'
import { slot } from 'pevenmui/web'
import { useT } from './i18n'
import { missingFx, type Project } from './project'
import { clearAutosave, loadAutosave, saveAutosave, type SavedTab } from './storage/autosave'

export function useAutosave(o: {
  project: Project
  fileName: string
  autoRestore: boolean
  /** 全タブの出し入れ（useProjectTabs） */
  tabs: { key: string; snapshotAll: () => { tabs: SavedTab[]; active: number }; restoreAll: (list: SavedTab[], active: number) => void }
  fail: (e: unknown) => void
  notify: (m: string) => void
  /** 復元が終わった（空のプロジェクトで前回の作業を上書きしないよう、それまでは書かない） */
  onRestored: () => void
  restored: boolean
}) {
  const t = useT()
  const { project, fileName, restored, fail } = o
  const p = { settings: { autoRestore: o.autoRestore } }
  const setNotice = o.notify
  const setRestored = (_: boolean) => o.onRestored()
  // 起動時に前回の作業を復元する（WeVocalSynth と同じ）
  useEffect(() => {
    // 上限を超えて開いたウィンドウ（枠なし）は自動保存しないことを知らせる
    if (slot === null) setNotice(t('window.noAutosave'))
    if (!p.settings.autoRestore) return setRestored(true)
    loadAutosave()
      .then((r) => {
        if (!r) return
        o.tabs.restoreAll(r.tabs, r.active)
        setNotice(t('toast.restored'))
        void Promise.all(r.tabs.map((x) => missingFx(x.project))).then((all) => [...new Set(all.flat())]).then((ids) => ids.length && setNotice(t('toast.missingPlugins', { ids: ids.join(', ') })))
      })
      .catch(fail)
      .finally(() => setRestored(true))
    // 起動時に 1 回だけ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 変わったら少し待って書く。設定で切ったら消す
  useEffect(() => {
    if (!restored) return
    if (!p.settings.autoRestore) return void clearAutosave().catch(fail)
    const id = setTimeout(() => {
      const all = o.tabs.snapshotAll()
      saveAutosave(all.tabs, all.active).catch(fail)
    }, 500)
    return () => clearTimeout(id)
  }, [project, fileName, o.tabs.key, restored, p.settings.autoRestore])

}
