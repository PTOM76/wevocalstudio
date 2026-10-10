// 操作の表（キーとメニューから行うもの）と、メニューバーの並び
import { useEffect, useRef, useState } from 'react'
import type { MenuEntry, MenuGroup } from 'pevenmui'
import type { Range } from 'wevocal-lib'
import { useT } from './i18n'
import { actionOf, keyLabel, type Action } from './keymap'
import type { Block, Track } from './project'
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
  recording: boolean
  detectTempo: () => void
  toggleRecord: () => void
  toggleRepeat: () => void
  seek: (t: number) => void
  /** 編集カーソルだけを動かす（再生は止めない） */
  moveCursor: (t: number) => void
  /** 表示の拡大（factor > 1）と縮小 */
  zoom: (factor: number) => void
  /** 線の 1 目盛り（秒。拍か秒） */
  gridStep: () => number
  newProject: () => void
  openProperties: (id: string) => void
  openFile: () => void
  importFiles: () => void
  /** その時刻とトラックへ音声ファイルを読み込む（トラックが無ければ空いているトラック） */
  importAt: (time: number, track: string | null) => void
  save: () => void
  /** 名前を付けて保存 */
  saveAs: () => void
  /** 最近使用したファイル（PevenMUI の useRecentFiles） */
  recent: { supported: boolean; names: string[]; open: (i: number) => void; clear: () => void }
  openExport: () => void
  openSettings: () => void
  openHistory: () => void
  snap: boolean
  toggleSnap: () => void
  follow: boolean
  envelope: boolean
  toggleEnvelope: () => void
  toggleFollow: () => void
  /** 線を拍と小節で取るか（でなければ秒） */
  beatGrid: boolean
  toggleGrid: () => void
  showAnalysis: boolean
  toggleAnalysis: () => void
  showMeters: boolean
  toggleMeters: () => void
  showMinimap: boolean
  toggleMinimap: () => void
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
  // コピーしたトラック（波形ブロックを選ばずにトラックを選んで Ctrl+C）
  const trackClipboard = useRef<{ track: Track; blocks: Block[] } | null>(null)
  // コピーしたら描き直す（「貼り付け」を押せるようにする。ref だけでは古いまま押せなかった）
  const [, setCopied] = useState(0)

  /** 選んでいるトラックの再生位置に置く（REAPER と同じ）。複数なら、トラックと時間の並びを保つ */
  /** 貼り付ける。at を渡せば、その時刻とトラックに（何もない所の右クリックの「ここに貼り付け」） */
  const paste = (place?: { time: number; track: string | null }) => {
    const cursor = place?.time ?? c.cursor
    const selectedTrack = place?.track ?? c.selectedTrack
    // トラックをコピーしていれば、選んでいるトラックのすぐ下に貼り付ける
    const tc = trackClipboard.current
    if (tc) {
      c.selectTrack(doc.insertTrack(tc.track, tc.blocks, selectedTrack))
      return
    }
    const blocks = clipboard.current
    if (!blocks.length) return
    const { tracks } = doc.project
    const first = Math.min(...blocks.map((b) => b.start))
    const top = Math.min(...blocks.map((b) => tracks.findIndex((tr) => tr.id === b.track)))
    const target = Math.max(0, tracks.findIndex((tr) => tr.id === selectedTrack))
    const at = (b: Block) => tracks[Math.min(tracks.length - 1, target + tracks.findIndex((tr) => tr.id === b.track) - top)] ?? tracks[target]
    c.select(doc.insertBlocks(blocks.map((b) => ({ ...b, track: at(b).id, start: cursor + b.start - first }))))
    // 貼り付けたものの右端に再生位置を移す（Ctrl+V を続けると、すき間なく並ぶ。REAPER と同じ）
    c.moveCursor(cursor + Math.max(...blocks.map((b) => b.start + b.length)) - first)
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
    record: { run: c.toggleRecord },
    detectTempo: { enabled: doc.project.blocks.length > 0, run: c.detectTempo },
    toStart: { run: () => c.seek(0) },
    cursorLeft: { run: () => c.seek(Math.max(0, c.cursor - c.gridStep())) },
    cursorRight: { run: () => c.seek(c.cursor + c.gridStep()) },
    nudgeLeft: { enabled: any, run: () => doc.updateBlocks(Object.fromEntries(chosen.map((b) => [b.id, { start: Math.max(0, b.start - c.gridStep()) }]))) },
    nudgeRight: { enabled: any, run: () => doc.updateBlocks(Object.fromEntries(chosen.map((b) => [b.id, { start: b.start + c.gridStep() }]))) },
    newProject: { run: c.newProject },
    toEnd: { run: () => c.seek(doc.project.blocks.reduce((m, b) => Math.max(m, b.start + b.length), 0)) },
    snap: { run: c.toggleSnap },
    follow: { run: c.toggleFollow },
    envelope: { run: c.toggleEnvelope },
    zoomIn: { run: () => c.zoom(1.5) },
    zoomOut: { run: () => c.zoom(1 / 1.5) },
    properties: { enabled: any, run: () => any && c.openProperties(chosen[0].id) },
    addMarker: { run: () => doc.addMarker(c.cursor) },
    nextMarker: { run: () => { const m = doc.project.markers.find((m) => m.time > c.cursor + 1e-3); if (m) c.seek(m.time) } },
    prevMarker: { run: () => { const m = doc.project.markers.findLast((m) => m.time < c.cursor - 1e-3); if (m) c.seek(m.time) } },
    split: { run: () => doc.split(c.cursor, ids) },
    splitSilence: { enabled: any, run: () => doc.splitBySilence(ids) },
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
    // 切り取り（コピーしてから消す）
    cut: {
      enabled: any,
      run: () => {
        clipboard.current = chosen
        trackClipboard.current = null
        setCopied((n) => n + 1)
        doc.removeBlocks(ids)
        c.select([])
      },
    },
    copy: {
      enabled: any || !!c.selectedTrack,
      run: () => {
        // 波形ブロックを選んでいればそれ、なければ選んでいるトラックを波形ブロックごと
        const track = !any ? doc.project.tracks.find((t) => t.id === c.selectedTrack) : undefined
        trackClipboard.current = track ? { track, blocks: doc.project.blocks.filter((b) => b.track === track.id) } : null
        clipboard.current = track ? [] : chosen
        setCopied((n) => n + 1)
      },
    },
    paste: { enabled: clipboard.current.length > 0 || !!trackClipboard.current, run: () => paste() },
    duplicate: { enabled: any, run: duplicate },
    open: { run: c.openFile },
    save: { run: c.save },
    saveAs: { run: c.saveAs },
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
  // 最近使用したファイル（使えないブラウザでは出さない。WeVocalSynth と同じ）
  const r = c.recent
  const recent: MenuEntry[] = r.supported
    ? [{ label: t('menu.recent'), onClick: () => {}, submenu: r.names.length ? [...r.names.map((name, i): MenuEntry => ({ label: name, onClick: () => r.open(i) })), divider, { label: t('menu.recentClear'), onClick: r.clear }] : [{ label: t('menu.recentEmpty'), disabled: true, onClick: () => {} }] }]
    : []

  const menus: MenuGroup[] = [
    {
      label: t('menu.file'),
      accessKey: 'F',
      entries: [item('newProject'), item('open'), ...recent, item('save'), item('saveAs'), divider, item('import'), item('export'), divider, { label: t('menu.settings'), onClick: c.openSettings }],
    },
    {
      label: t('menu.edit'),
      accessKey: 'E',
      entries: [item('undo'), item('redo'), { label: t('menu.history'), onClick: c.openHistory }, divider, item('cut'), item('copy'), item('paste'), item('duplicate'), item('selectAll'), item('split'), item('splitRange'), item('splitSilence'), item('delete'), divider, item('clearRange')],
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
        { label: t('track.addSubtrack'), disabled: !c.selectedTrack, onClick: () => c.selectedTrack && c.selectTrack(doc.addSubtrack(c.selectedTrack)) },
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
        { ...item('record'), checked: c.recording },
        { ...item('repeat'), checked: c.repeat },
        divider,
        item('toStart'),
        item('toEnd'),
        divider,
        item('detectTempo'),
        item('addMarker'),
        item('prevMarker'),
        item('nextMarker'),
      ],
    },
    {
      label: t('menu.view'),
      accessKey: 'V',
      entries: [item('zoomIn'), item('zoomOut'), divider, { ...item('snap'), checked: c.snap }, { ...item('follow'), checked: c.follow }, { ...item('envelope'), checked: c.envelope }, { label: t('menu.beatGrid'), checked: c.beatGrid, onClick: c.toggleGrid }, { label: t('menu.analysis'), checked: c.showAnalysis, onClick: c.toggleAnalysis }, { label: t('menu.meters'), checked: c.showMeters, onClick: c.toggleMeters }, { label: t('menu.minimap'), checked: c.showMinimap, onClick: c.toggleMinimap }, { label: t('menu.statusBar'), checked: c.showStatusBar, onClick: c.toggleStatusBar }],
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
    item('cut'),
    item('copy'),
    item('duplicate'),
    item('split'),
    item('delete'),
  ]

  /** 何もない所の右クリックのメニュー（REAPER のように、押した所に合わせた中身）。time と track は押した所 */
  const emptyMenu = (kind: 'lane' | 'ruler', time: number, track: string | null): MenuEntry[] =>
    kind === 'ruler'
      ? [
          { label: t('menu.addMarkerHere'), onClick: () => doc.addMarker(time) },
          item('detectTempo'),
          divider,
          item('clearRange'),
        ]
      : [
          { label: t('menu.pasteHere'), disabled: commands.paste.enabled === false, onClick: () => paste({ time, track }) },
          { label: t('menu.importHere'), onClick: () => c.importAt(time, track) },
          divider,
          item('selectAll'),
          item('splitRange'),
          item('clearRange'),
          divider,
          { label: t('menu.addTrack'), onClick: doc.addTrack },
        ]

  return { menus, blockMenu, emptyMenu, commands }
}
