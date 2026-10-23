// 操作の表（キーとメニューから行うもの）を作るフック。選択とコピーの状態を持ち、表（commands/table.ts）とメニュー（commands/menus.ts）に渡し、キーを受ける
import type { MidiBlock } from './project'
import { useEffect, useRef, useState } from 'react'
import { textSelected, useCommandSet } from 'pevenmui'
import { useT } from './i18n'
import { actionOf, currentKeymap, type Action } from './keymap'
import { type Block, type Source, type Track, midiBlocks } from './project'
import { ENVELOPES, type EnvKind } from './envelopes'
import { COMMANDS } from './commands/table'
import { buildMenus } from './commands/menus'
import type { ActionContext, Command, CommandEnv, CommandView } from './commands/types'

export type { ActionContext } from './commands/types'

export function useActions(c: ActionContext) {
  const t = useT()
  const { doc } = c
  // 選んでいるトラック（複数のうち最後に選んだもの。貼り付けや録音の先）
  const selectedTrack = doc.selectedTracks[doc.selectedTracks.length - 1] ?? null
  const selectTrack = (id: string | null) => doc.selectTracks(id ? [id] : [])
  // 選んでいる MIDI ブロック（ピアノロールで開く）
  const midiChosen = midiBlocks(doc.project).filter((b) => doc.selected.includes(b.id))
  const midiSel = midiChosen[0]
  const chosen = doc.project.blocks.filter((b) => doc.selected.includes(b.id))
  const ids = chosen.map((b) => b.id)
  // 波形ブロックか MIDI ブロックを選んでいる
  const any = chosen.length > 0 || midiChosen.length > 0
  const canSplit = [...chosen, ...midiChosen].some((b) => c.cursor > b.start + 0.001 && c.cursor < b.start + b.length - 0.001)
  const anyWave = chosen.length > 0
  const track = doc.project.tracks.find((tr) => tr.id === selectedTrack)
  const blockTrack = doc.project.tracks.find((tr) => tr.id === (midiChosen[0] ?? chosen[0])?.track)
  // 表示しているエンベロープに点がある、選んだ波形ブロック（初期化の対象）
  const envBlocks = c.envKind ? chosen.filter((b) => ENVELOPES[c.envKind!].points(b).length > 0) : []
  /** 波形ブロックのエンベロープ（音量かピッチ）の点を全部消す */
  const resetEnvelope = (kind: EnvKind, ids: string[]) => {
    const patches: Record<string, Partial<Block>> = {}
    for (const b of doc.project.blocks) if (ids.includes(b.id)) patches[b.id] = ENVELOPES[kind].patch(b, [])
    doc.updateBlocks(patches)
  }
  // コピーした波形ブロック。元の音はプロジェクトにあるものを指す
  const clipboard = useRef<Block[]>([])
  const midiClipboard = useRef<MidiBlock[]>([])
  // コピーしたトラック（波形ブロックを選ばずにトラックを選んで Ctrl+C）
  const trackClipboard = useRef<{ track: Track; blocks: Block[] } | null>(null)
  // コピーしたら描き直す（「貼り付け」を押せるようにする。ref だけでは古いまま押せなかった）
  const [, setCopied] = useState(0)
  // コピーしたものが使う元の音（タブをまたいで貼り付けるとき、足りなければ足す）
  const clipSources = useRef<Source[]>([])

  /** 選んでいるトラックの再生位置に置く。複数なら、トラックと時間の並びを保つ */
  /** 貼り付ける。at を渡せば、その時刻とトラックに（何もない所の右クリックの「ここに貼り付け」） */
  const paste = (place?: { time: number; track: string | null }) => {
    const cursor = place?.time ?? c.cursor
    const pasteTrack = place?.track ?? selectedTrack
    // トラックをコピーしていれば、選んでいるトラックのすぐ下に貼り付ける
    const tc = trackClipboard.current
    if (tc) {
      selectTrack(doc.insertTrack(tc.track, tc.blocks, pasteTrack, clipSources.current))
      return
    }
    const blocks = clipboard.current
    const midi = midiClipboard.current
    if (!blocks.length && !midi.length) return
    const { tracks } = doc.project
    // 波形ブロックと MIDI ブロックを合わせて、トラックと時間の並びを保つ
    const items = [...blocks, ...midi]
    const first = Math.min(...items.map((b) => b.start))
    const top = Math.min(...items.map((b) => tracks.findIndex((tr) => tr.id === b.track)))
    const target = Math.max(0, tracks.findIndex((tr) => tr.id === pasteTrack))
    const at = (b: { track: string }) => tracks[Math.min(tracks.length - 1, target + tracks.findIndex((tr) => tr.id === b.track) - top)] ?? tracks[target]
    const ids = [
      ...doc.insertBlocks(blocks.map((b) => ({ ...b, track: at(b).id, start: cursor + b.start - first })), clipSources.current),
      ...doc.insertMidi(midi.map((b) => ({ ...b, track: at(b).id, start: cursor + b.start - first }))),
    ]
    doc.select(ids)
    // 貼り付けたものの右端に再生位置を移す（Ctrl+V を続けると、すき間なく並ぶ）
    if (c.seekAfterInsert) c.moveCursor(cursor + Math.max(...items.map((b) => b.start + b.length)) - first)
  }

  /** 選んでいるものをまとめて、すぐ後ろに並べる */
  const duplicate = () => {
    const items = [...chosen, ...midiChosen]
    const first = Math.min(...items.map((b) => b.start))
    const last = Math.max(...items.map((b) => b.start + b.length))
    doc.select([...doc.insertBlocks(chosen.map((b) => ({ ...b, start: b.start + last - first }))), ...doc.insertMidi(midiChosen.map((b) => ({ ...b, start: b.start + last - first })))])
  }

  /** 選んでいるものを、グリッド 1 つぶん動かす（波形ブロックと MIDI ブロック） */
  const nudge = (dir: 1 | -1) => {
    const d = dir * c.gridStep()
    doc.updateBlocks(Object.fromEntries(chosen.map((b) => [b.id, { start: Math.max(0, b.start + d) }])))
    doc.updateMidiBlocks(Object.fromEntries(midiChosen.map((b) => [b.id, { start: Math.max(0, b.start + d) }])))
  }

  const env: CommandEnv = { c, doc, t, selectedTrack, selectTrack, midiChosen, midiSel, chosen, ids, any, anyWave, canSplit, track, blockTrack, envBlocks, resetEnvelope, clipboard, midiClipboard, trackClipboard, clipSources, copied: () => setCopied((n) => n + 1), paste, duplicate, nudge }
  // 表は静的なので、今の文脈（env）で判定と実行をする（PevenMUI の useCommandSet）。画面のボタンとメニューは、押せるかと実行の形で読む
  const set = useCommandSet(COMMANDS as Record<Action, Command>, env, currentKeymap(), t)
  const commands = Object.fromEntries((Object.keys(COMMANDS) as Action[]).map((id) => [id, { run: () => set.run(id), enabled: set.enabled(id) ? undefined : false }])) as Record<Action, CommandView>

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
      // 通知などの文字を選んでいるときのコピー、切り取りは、ブラウザの文字のコピーに任せる（波形ブロックのコピーと重ならないように）
      if ((action === 'copy' || action === 'cut') && textSelected()) return
      e.preventDefault()
      const cmd = latest.current[action]
      if (cmd.enabled !== false) cmd.run()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const { menus, blockMenu, emptyMenu, envelopeMenu } = buildMenus(env, commands)
  return { menus, blockMenu, emptyMenu, envelopeMenu, commands }
}