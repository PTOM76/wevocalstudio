// 1 つのプロジェクトの文書。プロジェクトと選んだブロックを履歴のストアに持ち、変更を通す（React を使わない。画面は useHistory で読む）
import { createHistoryStore, type FxSlot, type HistoryStore } from 'wevocal-lib'
import { describeChange } from '../history'
import type { MessageKey } from '../i18n'
import { midiBlocks, type Project } from '../project'

/** 履歴の 1 段（そのときのプロジェクトと選んでいた波形ブロック、そこへ来た操作の名前）。選択も元に戻せる */
export interface Step {
  project: Project
  selected: string[]
  label: MessageKey
}

export interface DocumentOptions {
  /** 元に戻せる回数（設定で変わるので、そのたびに読む） */
  limit: () => number
  /** 変更を通す前に直す（フリーズ中のトラックの波形ブロックを守るなど）。省くとそのまま通す */
  guard?: (prev: Project, next: Project) => Project
}

/** ドラッグやスライダーの途中の変更を、1 つの操作として積む（commit か cancel で終わる） */
export interface ProjectTransaction {
  update: (fn: (p: Project) => Project) => void
  commit: () => void
  cancel: () => void
}

export class ProjectDocument {
  readonly store: HistoryStore<Step>
  private readonly options: DocumentOptions

  constructor(project: Project, options: DocumentOptions) {
    this.options = options
    this.store = createHistoryStore<Step>({ project, selected: [], label: 'history.new' }, options.limit)
  }

  get project() {
    return this.store.get().present.project
  }

  get selected() {
    return this.store.get().present.selected
  }

  /** 変えたあとのプロジェクトと、消えた波形ブロックを外した選択から、履歴の 1 段を作る */
  private step(prev: Step, next: Project, label: MessageKey): Step {
    const selected = prev.selected.filter((id) => next.blocks.some((b) => b.id === id) || midiBlocks(next).some((b) => b.id === id))
    return { project: next, selected, label }
  }

  /** プロジェクトを変える。merge を渡すと、同じ merge の続けての変更を 1 回分の履歴にする（まとめるときは名前も前のまま） */
  change = (fn: (p: Project) => Project, merge?: string) =>
    this.store.commit((step, merged) => {
      const next = this.options.guard ? this.options.guard(step.project, fn(step.project)) : fn(step.project)
      return next === step.project ? step : this.step(step, next, merged ? step.label : describeChange(step.project, next))
    }, merge)

  /** 波形ブロックを選ぶ（履歴の 1 段になる。merge が同じなら、枠でのドラッグのように 1 段にまとめる） */
  select = (ids: string[], merge?: string) => {
    this.store.commit((step) => {
      const cur = step.selected
      if (ids.length === cur.length && ids.every((id, i) => id === cur[i])) return step
      return { ...step, selected: ids, label: 'history.select' }
    }, merge)
  }

  /** 続けての変更のまとまりを切る（ドラッグを離したとき） */
  endMerge = () => this.store.endMerge()

  /** ドラッグやスライダーの途中の変更を 1 つの操作にまとめる。cancel で始める前（選択も）に戻る */
  begin(): ProjectTransaction {
    const tx = this.store.begin()
    let base: Step | null = null
    return {
      update: (fn) =>
        tx.update((step) => {
          base ??= step
          const next = this.options.guard ? this.options.guard(base.project, fn(step.project)) : fn(step.project)
          return next === step.project ? step : this.step(base, next, describeChange(base.project, next))
        }),
      commit: tx.commit,
      cancel: tx.cancel,
    }
  }

  undo = () => this.store.undo()
  redo = () => this.store.redo()
  goto = (index: number) => this.store.goto(index)

  /** 開いたプロジェクトに入れ替える（履歴は消す） */
  replace = (p: Project, label: MessageKey = 'history.open') => this.store.reset({ project: p, selected: [], label })

  /** プラグインの状態を FX の項目に入れる。プラグイン自身が知らせるもので操作ではないので、履歴には積まない */
  setFxState = (target: string, index: number, state: string) => {
    const put = (fx: FxSlot[] | undefined) => (fx?.[index] && fx[index].state !== state ? fx.map((s, i) => (i === index ? { ...s, state } : s)) : fx)
    this.store.replacePresent((step) => {
      const p = step.project
      let next = p
      if (target === 'master') {
        const fx = put(p.master.fx)
        if (fx !== p.master.fx) next = { ...p, master: { ...p.master, fx } }
      } else {
        const t = p.tracks.find((x) => x.id === target)
        const fx = t && put(t.fx)
        if (t && fx !== t.fx) next = { ...p, tracks: p.tracks.map((x) => (x === t ? { ...x, fx } : x)) }
      }
      return next === p ? step : { ...step, project: next }
    })
  }
}
