// プロジェクトのタブ。表示している 1 つは今の画面の状態（文書、ファイル、カーソル、表示）が持ち、ほかのタブは、そのときの状態を記録（TabRecord）に退避しておく。切り替えは、今の状態を退避して、選んだ記録を戻す
import type { History } from 'wevocal-lib'
import type { TimelineView } from './drawTimeline'
import type { Step } from './document/ProjectDocument'
import type { Project } from './project'

/** 退避したタブの状態。F は、上書きする先のファイル */
export interface TabRecord<F = unknown> {
  /** 元に戻す、やり直す、選択まで含めた履歴 */
  history: History<Step>
  name: string
  /** 保存した（開いた）ときのプロジェクト。今と違えば、変更あり */
  saved: Project
  /** 上書きする先（保存か、開いたファイル）。なければ保存で選ぶ */
  file: F | null
  cursor: number
  view: TimelineView
}

/** 保存していない変更があるか（空のプロジェクトを開いただけのものは、変更なしとみなす） */
export const isDirty = (project: Project, saved: Project) => project !== saved && project.blocks.length + saved.blocks.length > 0

export const recordDirty = (r: Pick<TabRecord, 'history' | 'saved'>) => isDirty(r.history.present.project, r.saved)

/** タブ id を閉じたあとに表示するタブ（右隣、なければ左隣。ほかになければ null） */
export function neighborAfterClose(order: readonly string[], id: string): string | null {
  const i = order.indexOf(id)
  if (i < 0) return null
  return order[i + 1] ?? order[i - 1] ?? null
}

/** 何も置いていない、保存済みのプロジェクトか（ファイルを開くとき、新しいタブを作らず置き換えてよいか） */
export const isBlank = (project: Project, dirty: boolean) => !dirty && project.blocks.length === 0 && (project.midi?.length ?? 0) === 0 && project.tracks.length <= 1
