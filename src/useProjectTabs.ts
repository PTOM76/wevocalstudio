// プロジェクトのタブ（projectTabs.ts）。表示している 1 つは画面の状態、ほかは退避した記録。切り替えは、今の状態を退避して、選んだ記録を戻す
import { useRef, useState } from 'react'
import type { HistoryStore } from 'wevocal-lib'
import type { SavedFile } from 'pevenmui/web'
import type { TimelineView } from './drawTimeline'
import { freshHistory, type Step } from './document/ProjectDocument'
import type { Project } from './project'
import { neighborAfterClose, recordDirty, type TabRecord } from './projectTabs'

export const DEFAULT_VIEW: TimelineView = { scroll: 0, pps: 50 }

type Rec = TabRecord<SavedFile>

export function useProjectTabs(o: {
  store: HistoryStore<Step>
  /** 保存の印と上書き先の出し入れ（useProjectFile） */
  files: { snapshot: () => { saved: Project; file: SavedFile | null }; restore: (r: { saved: Project; file: SavedFile | null }) => void }
  name: string
  setName: (n: string) => void
  cursor: number
  setCursor: (t: number) => void
  view: TimelineView
  setView: (v: TimelineView) => void
  /** 切り替える前に再生を止める */
  stop: () => void
  /** 今のタブの、保存していない変更の有無 */
  dirty: boolean
}) {
  const { store, files } = o
  const nextId = useRef(1)
  const [order, setOrder] = useState<string[]>(['1'])
  const [active, setActive] = useState('1')
  // 表示していないタブの記録
  const records = useRef(new Map<string, Rec>())

  const capture = (): Rec => ({ history: store.get(), name: o.name, ...files.snapshot(), cursor: o.cursor, view: o.view })
  const apply = (r: Rec) => {
    store.restore(r.history)
    files.restore({ saved: r.saved, file: r.file })
    o.setName(r.name)
    o.setCursor(r.cursor)
    o.setView(r.view)
  }

  const select = (id: string) => {
    const r = records.current.get(id)
    if (id === active || !r) return
    o.stop()
    records.current.set(active, capture())
    records.current.delete(id)
    setActive(id)
    apply(r)
  }

  /** 新しいタブで、プロジェクトを開く（今のタブは、そのまま残す） */
  const add = (project: Project, name: string, file: SavedFile | null = null, label: 'history.new' | 'history.open' = 'history.new') => {
    o.stop()
    records.current.set(active, capture())
    const id = String(++nextId.current)
    setOrder((x) => [...x, id])
    setActive(id)
    apply({ history: freshHistory(project, label), name, saved: project, file, cursor: 0, view: DEFAULT_VIEW })
  }

  /** 今のタブを、プロジェクトに置き換える（何もしていないタブにファイルを開くとき） */
  const replaceActive = (project: Project, name: string, file: SavedFile | null, label: 'history.new' | 'history.open' = 'history.open') => {
    o.stop()
    apply({ history: freshHistory(project, label), name, saved: project, file, cursor: 0, view: DEFAULT_VIEW })
  }

  /** タブを閉じる（保存の確認は呼び出し側）。最後の 1 つは、新しいプロジェクトにする */
  const close = (id: string, blank: () => Project) => {
    if (id !== active) {
      records.current.delete(id)
      setOrder((x) => x.filter((v) => v !== id))
      return
    }
    const next = neighborAfterClose(order, id)
    if (!next) return replaceActive(blank(), 'untitled', null, 'history.new')
    o.stop()
    const r = records.current.get(next)
    records.current.delete(next)
    setOrder((x) => x.filter((v) => v !== id))
    setActive(next)
    if (r) apply(r)
  }

  const dirtyOf = (id: string) => (id === active ? o.dirty : !!records.current.get(id) && recordDirty(records.current.get(id)!))
  return {
    active,
    tabs: order.map((id) => ({ id, title: id === active ? o.name : (records.current.get(id)?.name ?? ''), dirty: dirtyOf(id) })),
    select,
    add,
    replaceActive,
    close,
    dirtyOf,
    /** どれかのタブに、保存していない変更があるか */
    anyDirty: () => order.some(dirtyOf),
  }
}
