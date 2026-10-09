// 操作の表（キーとメニューから行うもの）と、メニューバーの並び
import { useEffect, useRef } from 'react'
import type { MenuEntry, MenuGroup } from 'pevenmui'
import type { Range } from 'wevocal-lib'
import { useT } from './i18n'
import { KEYMAP, actionOf, keyLabel, type Action } from './keymap'
import type { Block } from './project'
import type { useProject } from './useProject'

type ProjectApi = ReturnType<typeof useProject>

export interface ActionContext {
  doc: ProjectApi
  cursor: number
  playing: boolean
  selected: string | null
  selectedTrack: string | null
  /** 範囲選択（REAPER のタイムセレクション） */
  range: Range | null
  setRange: (r: Range | null) => void
  select: (id: string | null) => void
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
  const block = doc.project.blocks.find((b) => b.id === c.selected)
  // コピーした波形ブロック。元の音はプロジェクトにあるものを指す
  const clipboard = useRef<Block | null>(null)

  const paste = () => {
    const b = clipboard.current
    if (!b) return
    // 選んでいるトラックの再生位置に置く（REAPER と同じ）
    const track = doc.project.tracks.find((tr) => tr.id === c.selectedTrack) ?? doc.project.tracks.find((tr) => tr.id === b.track) ?? doc.project.tracks[0]
    if (track) c.select(doc.insertBlock(b, { track: track.id, start: c.cursor }))
  }

  const commands: Record<Action, Command> = {
    playStop: { run: () => (c.playing ? c.stop() : c.play()) },
    stop: { run: c.stop },
    pause: { run: () => (c.playing ? c.pause() : c.play()) },
    repeat: { run: c.toggleRepeat },
    toStart: { run: () => c.seek(0) },
    toEnd: { run: () => c.seek(doc.project.blocks.reduce((m, b) => Math.max(m, b.start + b.length), 0)) },
    zoomIn: { run: () => c.zoom(1.5) },
    zoomOut: { run: () => c.zoom(1 / 1.5) },
    properties: { enabled: !!block, run: () => block && c.openProperties(block.id) },
    split: { run: () => doc.split(c.cursor, c.selected ?? undefined) },
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
      enabled: !!block,
      run: () => {
        if (block) doc.removeBlock(block.id)
        c.select(null)
      },
    },
    undo: { enabled: doc.canUndo, run: doc.undo },
    redo: { enabled: doc.canRedo, run: doc.redo },
    copy: { enabled: !!block, run: () => (clipboard.current = block ?? null) },
    paste: { enabled: !!clipboard.current, run: paste },
    // すぐ後ろに並べる
    duplicate: { enabled: !!block, run: () => block && c.select(doc.insertBlock(block, { start: block.start + block.length })) },
    open: { run: c.openFile },
    save: { run: c.save },
    import: { run: c.importFiles },
    export: { enabled: doc.project.blocks.length > 0, run: c.openExport },
    pitchUp: { enabled: !!block, run: () => block && doc.nudgePitch(block.id, 1) },
    pitchDown: { enabled: !!block, run: () => block && doc.nudgePitch(block.id, -1) },
    pitchUpFine: { enabled: !!block, run: () => block && doc.nudgePitch(block.id, 0.1) },
    pitchDownFine: { enabled: !!block, run: () => block && doc.nudgePitch(block.id, -0.1) },
    pitchReset: { enabled: !!block, run: () => block && doc.nudgePitch(block.id, null) },
  }

  // キーの割り当ては keymap.ts の表。文字の入力中は奪わない
  const latest = useRef(commands)
  latest.current = commands
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
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
    shortcut: KEYMAP[a].length ? keyLabel(a) : undefined,
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
      entries: [item('undo'), item('redo'), divider, item('copy'), item('paste'), item('duplicate'), item('split'), item('splitRange'), item('delete'), divider, item('clearRange')],
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
            c.select(null)
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
      entries: [item('zoomIn'), item('zoomOut'), divider, { label: t('menu.statusBar'), checked: c.showStatusBar, onClick: c.toggleStatusBar }],
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
