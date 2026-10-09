// 操作の表（キーとメニューから行うもの）と、メニューバーの並び
import { useEffect, useRef } from 'react'
import type { MenuEntry, MenuGroup } from 'pevenmui'
import type { Range } from 'wevocal-lib'
import { useT } from './i18n'
import { actionOf, keyLabel, type Action } from './keymap'
import type { Block } from './project'
import type { useProject } from './useProject'

type ProjectApi = ReturnType<typeof useProject>

export interface ActionContext {
  doc: ProjectApi
  cursor: number
  playing: boolean
  /** 選んでいる波形ブロック（複数） */
  selected: string[]
  selectedTrack: string | null
  /** 範囲選択（REAPER のタイムセレクション） */
  range: Range | null
  setRange: (r: Range | null) => void
  select: (ids: string[]) => void
  selectTrack: (id: string | null) => void
  play: () => void
  /** 止めて、再生を始めた位置に戻る */
  stop: () => void
  /** その場で止める */
  pause: () => void
  repeat: boolean
  toggleRepeat: () => void
  seek: (t: number) => void
  /** 表示の拡大（factor > 1）と縮小 */
  zoom: (factor: number) => void
  openProperties: (id: string) => void
  openFile: () => void
  importFiles: () => void
  save: () => void
  openExport: () => void
  openSettings: () => void
  snap: boolean
  toggleSnap: () => void
  /** 線を拍と小節で取るか（でなければ秒） */
  beatGrid: boolean
  toggleGrid: () => void
  showStatusBar: boolean
  toggleStatusBar: () => void
  help: { guide: () => void; licenses: () => void; about: () => void }
}

interface Command {
  run: () => void
  /** 押せるか（省略なら押せる） */
  enabled?: boolean
}

export function useActions(c: ActionContext) {
  const t = useT()
  const { doc } = c
  const chosen = doc.project.blocks.filter((b) => c.selected.includes(b.id))
  const ids = chosen.map((b) => b.id)
  const any = chosen.length > 0
  // コピーした波形ブロック。元の音はプロジェクトにあるものを指す
  const clipboard = useRef<Block[]>([])

  /** 選んでいるトラックの再生位置に置く（REAPER と同じ）。複数なら、トラックと時間の並びを保つ */
  const paste = () => {
    const blocks = clipboard.current
    if (!blocks.length) return
    const { tracks } = doc.project
    const first = Math.min(...blocks.map((b) => b.start))
    const top = Math.min(...blocks.map((b) => tracks.findIndex((tr) => tr.id === b.track)))
    const target = Math.max(0, tracks.findIndex((tr) => tr.id === c.selectedTrack))
    const at = (b: Block) => tracks[Math.min(tracks.length - 1, target + tracks.findIndex((tr) => tr.id === b.track) - top)] ?? tracks[target]
    c.select(doc.insertBlocks(blocks.map((b) => ({ ...b, track: at(b).id, start: c.cursor + b.start - first }))))
  }

  /** 選んでいるものをまとめて、すぐ後ろに並べる */
  const duplicate = () => {
    const first = Math.min(...chosen.map((b) => b.start))
    const last = Math.max(...chosen.map((b) => b.start + b.length))
    c.select(doc.insertBlocks(chosen.map((b) => ({ ...b, start: b.start + last - first }))))
  }

  const commands: Record<Action, Command> = {
    playStop: { run: () => (c.playing ? c.stop() : c.play()) },
    stop: { run: c.stop },
    pause: { run: () => (c.playing ? c.pause() : c.play()) },
    repeat: { run: c.toggleRepeat },
    toStart: { run: () => c.seek(0) },
    toEnd: { run: () => c.seek(doc.project.blocks.reduce((m, b) => Math.max(m, b.start + b.length), 0)) },
    snap: { run: c.toggleSnap },
    zoomIn: { run: () => c.zoom(1.5) },
    zoomOut: { run: () => c.zoom(1 / 1.5) },
    properties: { enabled: any, run: () => any && c.openProperties(chosen[0].id) },
    split: { run: () => doc.split(c.cursor, ids) },
    selectAll: { run: () => c.select(doc.project.blocks.map((b) => b.id)) },
    // 範囲の両端で、かかっている波形ブロックを全部分ける
    splitRange: {
      enabled: !!c.range,
      run: () => {
        if (!c.range) return
        doc.split(c.range.start)
        doc.split(c.range.end)
      },
    },
    clearRange: { enabled: !!c.range, run: () => c.setRange(null) },
    delete: {
      enabled: any,
      run: () => {
        doc.removeBlocks(ids)
        c.select([])
      },
    },
    undo: { enabled: doc.canUndo, run: doc.undo },
    redo: { enabled: doc.canRedo, run: doc.redo },
    copy: { enabled: any, run: () => (clipboard.current = chosen) },
    paste: { enabled: clipboard.current.length > 0, run: paste },
    duplicate: { enabled: any, run: duplicate },
    open: { run: c.openFile },
    save: { run: c.save },
    import: { run: c.importFiles },
    export: { enabled: doc.project.blocks.length > 0, run: c.openExport },
    pitchUp: { enabled: any, run: () => doc.nudgePitch(ids, 1) },
    pitchDown: { enabled: any, run: () => doc.nudgePitch(ids, -1) },
    pitchUpFine: { enabled: any, run: () => doc.nudgePitch(ids, 0.1) },
    pitchDownFine: { enabled: any, run: () => doc.nudgePitch(ids, -0.1) },
    pitchReset: { enabled: any, run: () => doc.nudgePitch(ids, null) },
  }

  // キーの割り当ては keymap.ts の表。文字の入力中は奪わない
  const latest = useRef(commands)
  latest.current = commands
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 文字を打つ欄にいるときと、日本語の変換中は奪わない。スライダーやチェックの input は文字を打たないので奪う
      // （スライダーを触ったあとにフォーカスが残り、Shift+0 などが効かなかった）
      const el = e.target
      if (e.isComposing || el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && !['range', 'checkbox', 'radio', 'button'].includes(el.type))) return
      if (el instanceof HTMLElement && el.isContentEditable) return
      const action = actionOf(e)
      if (!action) return
      e.preventDefault()
      const cmd = latest.current[action]
      if (cmd.enabled !== false) cmd.run()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  /** メニューの項目（名前は menu.<操作の名前>） */
  const item = (a: Action, label = t(`menu.${a}` as Parameters<typeof t>[0])): MenuEntry => ({
    label,
    shortcut: keyLabel(a) || undefined,
    disabled: commands[a].enabled === false,
    onClick: commands[a].run,
  })
  const divider: MenuEntry = { divider: true }

  const menus: MenuGroup[] = [
    {
      label: t('menu.file'),
      accessKey: 'F',
      entries: [item('open'), item('save'), divider, item('import'), item('export'), divider, { label: t('menu.settings'), onClick: c.openSettings }],
    },
    {
      label: t('menu.edit'),
      accessKey: 'E',
      entries: [item('undo'), item('redo'), divider, item('copy'), item('paste'), item('duplicate'), item('selectAll'), item('split'), item('splitRange'), item('delete'), divider, item('clearRange')],
    },
    {
      label: t('menu.block'),
      accessKey: 'I',
      entries: [item('properties'), divider, item('pitchUp'), item('pitchDown'), item('pitchUpFine'), item('pitchDownFine'), item('pitchReset')],
    },
    {
      label: t('menu.track'),
      accessKey: 'T',
      entries: [
        { label: t('menu.addTrack'), onClick: doc.addTrack },
        {
          label: t('menu.removeTrack'),
          disabled: !c.selectedTrack,
          onClick: () => {
            if (c.selectedTrack) doc.removeTrack(c.selectedTrack)
            c.selectTrack(null)
            c.select([])
          },
        },
      ],
    },
    {
      label: t('menu.transport'),
      accessKey: 'P',
      entries: [
        item('playStop', c.playing ? t('menu.stop') : t('menu.play')),
        item('pause'),
        { ...item('repeat'), checked: c.repeat },
        divider,
        item('toStart'),
        item('toEnd'),
      ],
    },
    {
      label: t('menu.view'),
      accessKey: 'V',
      entries: [item('zoomIn'), item('zoomOut'), divider, { ...item('snap'), checked: c.snap }, { label: t('menu.beatGrid'), checked: c.beatGrid, onClick: c.toggleGrid }, { label: t('menu.statusBar'), checked: c.showStatusBar, onClick: c.toggleStatusBar }],
    },
    {
      label: t('menu.help'),
      accessKey: 'H',
      entries: [
        { label: t('menu.guide'), onClick: c.help.guide },
        { label: t('menu.licenses'), onClick: c.help.licenses },
        { label: t('menu.about'), onClick: c.help.about },
      ],
    },
  ]

  /** 波形ブロックの右クリックのメニュー */
  const blockMenu: MenuEntry[] = [
    item('properties'),
    divider,
    item('pitchUp'),
    item('pitchDown'),
    item('pitchReset'),
    divider,
    item('copy'),
    item('duplicate'),
    item('split'),
    item('delete'),
  ]

  return { menus, blockMenu }
}
