// 起動時に前回の作業を戻し、変わったら少し待って書く（WeVocalSynth と同じ。書き込みは Worker）
import { useEffect } from 'react'
import { slot } from 'pevenmui/web'
import type { MessageKey } from './i18n'
import { useT } from './i18n'
import type { Project } from './project'
import { clearAutosave, loadAutosave, saveAutosave } from './storage/autosave'

export function useAutosave(o: {
  project: Project
  fileName: string
  autoRestore: boolean
  replace: (p: Project, label?: MessageKey) => void
  setFileName: (n: string) => void
  fail: (e: unknown) => void
  notify: (m: string) => void
  /** 復元が終わった（空のプロジェクトで前回の作業を上書きしないよう、それまでは書かない） */
  onRestored: () => void
  restored: boolean
}) {
  const t = useT()
  const { project, fileName, restored, fail } = o
  const p = { settings: { autoRestore: o.autoRestore } }
  const doc = { replace: o.replace }
  const setFileName = o.setFileName
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
        doc.replace(r.project, 'history.restore')
        setFileName(r.fileName)
        setNotice(t('toast.restored'))
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
    const id = setTimeout(() => saveAutosave(project, fileName).catch(fail), 500)
    return () => clearTimeout(id)
  }, [project, fileName, restored, p.settings.autoRestore])

}
