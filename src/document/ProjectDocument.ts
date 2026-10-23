// 1 つのプロジェクトの文書。プロジェクトと選んだブロックを履歴のストアに持ち、変更を通す（React を使わない。画面は useHistory で読む）
import { createHistoryStore, type FxSlot, type HistoryStore, type Range } from 'wevocal-lib'
import { describeChange } from '../history'
import type { MessageKey } from '../i18n'
import { midiBlocks, type Project } from '../project'

/** 選択（波形ブロックと MIDI ブロック、トラック、範囲）。履歴の 1 段に入り、元に戻せる */
export interface Selection {
  /** 選んでいるブロック（波形と MIDI） */
  selected: string[]
  /** 選んでいるトラック（最後に選んだものが「選んでいるトラック」） */
  selectedTracks: string[]
  range: Range | null
}

/** 履歴の 1 段（そのときのプロジェクトと選択、そこへ来た操作の名前） */
export interface Step extends Selection {
  project: Project
  label: MessageKey
}

const NO_SELECTION: Selection = { selected: [], selectedTracks: [], range: null }

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
    this.store = createHistoryStore<Step>({ project, ...NO_SELECTION, label: 'history.new' }, options.limit)
  }

  get project() {
    return this.store.get().present.project
  }

  get selected() {
    return this.store.get().present.selected
  }

  get selectedTracks() {
    return this.store.get().present.selectedTracks
  }

  get range() {
    return this.store.get().present.range
  }

/** 変えたあとのプロジェクトと、消えたブロックとトラックを外した選択から、履歴の 1 段を作る。sel はいっしょに変える選択 */
  private step(prev: Step, next: Project, label: MessageKey, sel: Partial<Selection> = {}): Step {
    const selected = (sel.selected ?? prev.selected).filter((id) => next.blocks.some((b) => b.id === id) || midiBlocks(next).some((b) => b.id === id))
    const selectedTracks = (sel.selectedTracks ?? prev.selectedTracks).filter((id) => next.tracks.some((t) => t.id === id))
    return { project: next, selected, selectedTracks, range: sel.range !== undefined ? sel.range : prev.range, label }
  }

  /** プロジェクトを変える。merge を渡すと、同じ merge の続けての変更を 1 回分の履歴にする（まとめるときは名前も前のまま）。sel を渡すと、選択もいっしょに変える（範囲を外すなど。履歴は 1 段のまま） */
  change = (fn: (p: Project) => Project, merge?: string, sel?: Partial<Selection>) =>
    this.store.commit((step, merged) => {
      const next = this.options.guard ? this.options.guard(step.project, fn(step.project)) : fn(step.project)
      return next === step.project && !sel ? step : this.step(step, next, merged ? step.label : next === step.project ? 'history.select' : describeChange(step.project, next), sel)
    }, merge)

  /** 波形ブロックを選ぶ（履歴の 1 段になる。merge が同じなら、枠でのドラッグのように 1 段にまとめる） */
  select = (ids: string[], merge?: string) => {
    this.store.commit((step) => {
      const cur = step.selected
      if (ids.length === cur.length && ids.every((id, i) => id === cur[i])) return step
      return { ...step, selected: ids, label: 'history.select' }
    }, merge)
  }

  /** 選んでいるトラックを変える（履歴の 1 段になる） */
  selectTracks = (ids: string[], merge?: string) => {
    this.store.commit((step) => {
      const cur = step.selectedTracks
      if (ids.length === cur.length && ids.every((id, i) => id === cur[i])) return step
      return { ...step, selectedTracks: ids, label: 'history.select' }
    }, merge)
  }

  /** 範囲を変える（履歴の 1 段になる。ドラッグ中は merge で 1 段にまとめる）。null で外す */
  selectRange = (range: Range | null, merge?: string) => {
    this.store.commit((step) => {
      const cur = step.range
      if (cur === range || (cur && range && cur.start === range.start && cur.end === range.end)) return step
      return { ...step, range, label: 'history.select' }
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
  replace = (p: Project, label: MessageKey = 'history.open') => this.store.reset({ project: p, ...NO_SELECTION, label })

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
