// プロジェクトの状態と操作（読み込み、マスター、トラック、波形ブロックの変更）と、元に戻す、やり直す
import { useCallback, useRef, useState } from 'react'
import { DEFAULT_SILENCE, decodeFile, findSounds, type Clip } from 'wevocal-lib'
import { describeChange } from './history'
import type { MessageKey } from './i18n'
import { DEFAULT_FADE, fitBlock, newBlock, newId, newProject, newTrack, splitBlock, type Block, type Marker, type Master, type PitchDefaults, type Project, type Source, type Tempo, type Track } from './project'

/** ピッチの範囲（半音）。大きく変えるときは wasm が 24 半音ずつに分けて処理する */
const PITCH_MAX = 256
/** 元に戻せる回数 */
const HISTORY_MAX = 200

/** 置く場所（トラックと時刻）。省略したときは空いているトラックか、新しいトラック */
export interface DropAt {
  track: string
  start: number
}

/** 履歴の 1 段（そのときのプロジェクトと選んでいた波形ブロック、そこへ来た操作の名前）。選択も元に戻せる（REAPER の「選択も元に戻す」と同じ） */
interface Step {
  project: Project
  selected: string[]
  label: MessageKey
}

interface History {
  past: Step[]
  present: Step
  future: Step[]
}

export function useProject(defaults: PitchDefaults) {
  const [history, setHistory] = useState<History>(() => ({ past: [], present: { project: newProject(), selected: [], label: 'history.new' }, future: [] }))
  // 読み込みの途中で設定が変わっても、最新の既定値を使う
  const defaultsRef = useRef(defaults)
  defaultsRef.current = defaults
  // 直前の変更のまとめ方。同じ merge が続いたら（ドラッグ、スライダー）履歴を 1 つにまとめる
  const lastMerge = useRef<string | null>(null)

  /** プロジェクトを変える。merge を渡すと、同じ merge の続けての変更を 1 回分の履歴にする */
  const change = useCallback((fn: (p: Project) => Project, merge?: string) => {
    const merged = merge !== undefined && merge === lastMerge.current
    lastMerge.current = merge ?? null
    setHistory((h) => {
      const next = fn(h.present.project)
      if (next === h.present.project) return h
      // まとめるときは名前も前のまま
      // 消えた波形ブロックは選択から外す
      const selected = h.present.selected.filter((id) => next.blocks.some((b) => b.id === id))
      const present = { project: next, selected, label: merged ? h.present.label : describeChange(h.present.project, next) }
      return { past: merged ? h.past : [...h.past, h.present].slice(-HISTORY_MAX), present, future: [] }
    })
  }, [])

  /** 波形ブロックを選ぶ（履歴の 1 段になる。merge が同じなら、枠でのドラッグのように 1 段にまとめる） */
  const select = useCallback((ids: string[], merge?: string) => {
    const merged = merge !== undefined && merge === lastMerge.current
    lastMerge.current = merge ?? null
    setHistory((h) => {
      const cur = h.present.selected
      if (ids.length === cur.length && ids.every((id, i) => id === cur[i])) return h
      const present = { ...h.present, selected: ids, label: 'history.select' as MessageKey }
      return { past: merged ? h.past : [...h.past, h.present].slice(-HISTORY_MAX), present, future: [] }
    })
  }, [])

  /** 続けての変更のまとまりを切る（ドラッグを離したとき） */
  const endMerge = useCallback(() => {
    lastMerge.current = null
  }, [])

  const undo = useCallback(() => {
    lastMerge.current = null
    setHistory((h) => (h.past.length ? { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] } : h))
  }, [])

  const redo = useCallback(() => {
    lastMerge.current = null
    setHistory((h) => (h.future.length ? { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) } : h))
  }, [])

  /** 履歴の index 番目（0 が一番古い。past の長さが今）へ行く（操作履歴の一覧から） */
  const goto = useCallback((index: number) => {
    lastMerge.current = null
    setHistory((h) => {
      const all = [...h.past, h.present, ...h.future]
      if (index < 0 || index >= all.length) return h
      return { past: all.slice(0, index), present: all[index], future: all.slice(index + 1) }
    })
  }, [])

  /** 開いたプロジェクトに入れ替える（履歴は消す） */
  const replace = useCallback((p: Project, label: MessageKey = 'history.open') => {
    lastMerge.current = null
    setHistory({ past: [], present: { project: p, selected: [], label }, future: [] })
  }, [])

  /** 録った音を、指定したトラックの start 秒に波形ブロックとして置く */
  const addClip = useCallback(
    (clip: Clip, name: string, track: string, start: number) => {
      const source: Source = { id: newId(), name, clip, duration: clip.channels[0].length / clip.sampleRate }
      change((p) => ({ ...p, sources: [...p.sources, source], blocks: [...p.blocks, newBlock(track, source, start, defaultsRef.current)] }))
    },
    [change],
  )

  /** 選んだ波形ブロックに、プロパティで変えた値をまとめて掛ける。速度だけ変えたら長さも合わせる（REAPER と同じ）。元の音の長さに収める */
  const editBlocks = useCallback(
    (ids: string[], edit: Partial<Block>) =>
      change((p) => ({
        ...p,
        blocks: p.blocks.map((b) => {
          if (!ids.includes(b.id)) return b
          const next = { ...b, ...edit }
          if (edit.rate !== undefined && edit.length === undefined) next.length = (b.length * b.rate) / edit.rate
          // 元の音を変えたら、ピッチカーブは合わなくなるので外す
          if (edit.source && edit.source !== b.source) next.curve = undefined
          const source = p.sources.find((s) => s.id === next.source)
          return source ? fitBlock(next, source.duration) : next
        }),
      })),
    [change],
  )

  /** ファイルを読み込んで、選んだ波形ブロックの元の音にする */
  const replaceSource = useCallback(
    async (ids: string[], file: File) => {
      const clip = await decodeFile(file)
      const source: Source = { id: newId(), name: file.name, clip, duration: clip.channels[0].length / clip.sampleRate }
      change((p) => ({
        ...p,
        sources: [...p.sources, source],
        blocks: p.blocks.map((b) => (ids.includes(b.id) ? fitBlock({ ...b, source: source.id, curve: undefined }, source.duration) : b)),
      }))
    },
    [change],
  )

  /** 新しいトラックを足して、その id を返す */
  const addTrackNow = useCallback(() => {
    const track = newTrack(0)
    change((p) => ({ ...p, tracks: [...p.tracks, { ...track, name: `Track ${p.tracks.length + 1}` }] }))
    return track.id
  }, [change])

  /** ファイルを読み込んで波形ブロックとして置く。場所を指定したら、そのトラックに続けて並べる */
  const addFiles = useCallback(
    async (files: File[], at?: DropAt) => {
      let start = at?.start ?? 0
      for (const file of files) {
        const clip = await decodeFile(file)
        const source: Source = { id: newId(), name: file.name, clip, duration: clip.channels[0].length / clip.sampleRate }
        const name = file.name.replace(/\.[^.]+$/, '')
        const begin = start
        change((p) => {
          let tracks = p.tracks
          let track = at && tracks.find((t) => t.id === at.track)
          if (!track) {
            // 波形ブロックのない最初のトラックを使い、なければ足す。空のトラックの名前はファイルの名前にする
            const empty = tracks.find((t) => !p.blocks.some((b) => b.track === t.id))
            track = { ...(empty ?? newTrack(tracks.length + 1)), name }
            const named = track
            tracks = empty ? tracks.map((t) => (t.id === named.id ? named : t)) : [...tracks, named]
          }
          return { ...p, sources: [...p.sources, source], tracks, blocks: [...p.blocks, newBlock(track.id, source, begin, defaultsRef.current)] }
        })
        if (at) start += source.duration
      }
    },
    [change],
  )

  const addTrack = useCallback(() => change((p) => ({ ...p, tracks: [...p.tracks, newTrack(p.tracks.length + 1)] })), [change])

  /** トラックを波形ブロックごと写して、すぐ下に置く */
  const duplicateTrack = useCallback(
    (id: string) =>
      change((p) => {
        const i = p.tracks.findIndex((t) => t.id === id)
        if (i < 0) return p
        const copy = { ...p.tracks[i], id: newId(), name: `${p.tracks[i].name} (2)`, armed: false }
        const blocks = p.blocks.filter((b) => b.track === id).map((b) => ({ ...b, id: newId(), track: copy.id }))
        return { ...p, tracks: [...p.tracks.slice(0, i + 1), copy, ...p.tracks.slice(i + 1)], blocks: [...p.blocks, ...blocks] }
      }),
    [change],
  )

  /** トラックの写しを、after のすぐ下（なければ一番下）に波形ブロックごと置き、新しい id を返す（貼り付け） */
  const insertTrack = useCallback(
    (track: Track, blocks: Block[], after: string | null) => {
      const copy = { ...track, id: newId(), armed: false }
      change((p) => {
        const i = after ? p.tracks.findIndex((t) => t.id === after) : -1
        const at = i < 0 ? p.tracks.length : i + 1
        const bs = blocks.filter((b) => p.sources.some((s) => s.id === b.source)).map((b) => ({ ...b, id: newId(), track: copy.id }))
        return { ...p, tracks: [...p.tracks.slice(0, at), copy, ...p.tracks.slice(at)], blocks: [...p.blocks, ...bs] }
      })
      return copy.id
    },
    [change],
  )

  /** トラックとその波形ブロックを消す。使われなくなった元の音も消す */
  const removeTrack = useCallback(
    (id: string) =>
      change((p) => {
        const blocks = p.blocks.filter((b) => b.track !== id)
        return { ...p, tracks: p.tracks.filter((t) => t.id !== id), blocks, sources: p.sources.filter((s) => blocks.some((b) => b.source === s.id)) }
      }),
    [change],
  )

  /** マーカーを足す（同じ位置にあれば足さない）。名前は M1、M2… */
  const addMarker = useCallback(
    (time: number) =>
      change((p) => (p.markers.some((m) => Math.abs(m.time - time) < 1e-3) ? p : { ...p, markers: [...p.markers, { id: newId(), time, name: `M${p.markers.length + 1}` }].sort((a, b) => a.time - b.time) })),
    [change],
  )
  const updateMarker = useCallback((id: string, patch: Partial<Marker>) => change((p) => ({ ...p, markers: p.markers.map((m) => (m.id === id ? { ...m, ...patch } : m)) })), [change])
  const removeMarker = useCallback((id: string) => change((p) => ({ ...p, markers: p.markers.filter((m) => m.id !== id) })), [change])

  const updateTempo = useCallback((patch: Partial<Tempo>, merge?: string) => change((p) => ({ ...p, tempo: { ...p.tempo, ...patch } }), merge), [change])

  const updateMaster = useCallback((patch: Partial<Master>, merge?: string) => change((p) => ({ ...p, master: { ...p.master, ...patch } }), merge), [change])

  const updateTrack = useCallback(
    (id: string, patch: Partial<Track>, merge?: string) => change((p) => ({ ...p, tracks: p.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)) }), merge),
    [change],
  )

  /** 複数のトラックを一度に変える（選んだトラックをまとめて） */
  const updateTracks = useCallback(
    (patches: Record<string, Partial<Track>>, merge?: string) => change((p) => ({ ...p, tracks: p.tracks.map((t) => (patches[t.id] ? { ...t, ...patches[t.id] } : t)) }), merge),
    [change],
  )

  const updateBlock = useCallback(
    (id: string, patch: Partial<Block>, merge?: string) => change((p) => ({ ...p, blocks: p.blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)) }), merge),
    [change],
  )

  /** 複数の波形ブロックを一度に変える（まとめて動かすとき）。id → 変える値 */
  const updateBlocks = useCallback(
    (patches: Record<string, Partial<Block>>, merge?: string) => change((p) => ({ ...p, blocks: p.blocks.map((b) => (patches[b.id] ? { ...b, ...patches[b.id] } : b)) }), merge),
    [change],
  )

  const removeBlocks = useCallback((ids: string[]) => change((p) => ({ ...p, blocks: p.blocks.filter((b) => !ids.includes(b.id)) })), [change])

  /** 波形ブロックの写しを置き、新しい id を返す（複製、貼り付け）。元の音がもう無いものは置かない */
  const insertBlocks = useCallback(
    (blocks: Block[]) => {
      const copies = blocks.map((b) => ({ ...b, id: newId() }))
      change((p) => ({ ...p, blocks: [...p.blocks, ...copies.filter((b) => p.sources.some((s) => s.id === b.source))] }))
      return copies.map((b) => b.id)
    },
    [change],
  )

  /** ピッチを delta 半音だけ変える。delta が null なら 0 に戻す。小数の誤差は 0.01 半音（1 セント）に丸める */
  const nudgePitch = useCallback(
    (ids: string[], delta: number | null) =>
      change((p) => ({
        ...p,
        blocks: p.blocks.map((b) => (ids.includes(b.id) ? { ...b, pitch: delta === null ? 0 : Math.max(-PITCH_MAX, Math.min(PITCH_MAX, Math.round((b.pitch + delta) * 100) / 100)) } : b)),
      })),
    [change],
  )

  /** 無音で区切り、音のある所だけを残す（WeVocalSynth の「無音で区切る」と同じ判定。-40dB、200ms） */
  const splitBySilence = useCallback(
    (ids: string[]) =>
      change((p) => ({
        ...p,
        blocks: p.blocks.flatMap((b) => {
          const source = p.sources.find((s) => s.id === b.source)
          if (!ids.includes(b.id) || !source) return [b]
          const { clip } = source
          const from = Math.floor(b.offset * clip.sampleRate)
          const to = Math.min(clip.channels[0].length, from + Math.ceil(b.length * b.rate * clip.sampleRate))
          const part = { sampleRate: clip.sampleRate, channels: clip.channels.map((c) => c.subarray(from, to)) }
          const sounds = findSounds(part, DEFAULT_SILENCE)
          if (!sounds.length) return [b]
          // 範囲は元の音の上の秒。時間軸の上では速度で割る
          return sounds.map((r, i) => {
            const length = (r.end - r.start) / b.rate
            return { ...b, id: i ? newId() : b.id, start: b.start + r.start / b.rate, offset: b.offset + r.start, length, fadeIn: Math.min(DEFAULT_FADE, length / 2), fadeOut: Math.min(DEFAULT_FADE, length / 2) }
          })
        }),
      })),
    [change],
  )

  /** 位置 t で分ける。ids が空なら、t にかかる波形ブロックを全部分ける */
  const split = useCallback(
    (t: number, ids: string[] = []) => change((p) => ({ ...p, blocks: p.blocks.flatMap((b) => (ids.length && !ids.includes(b.id) ? [b] : (splitBlock(b, t) ?? [b]))) })),
    [change],
  )

  return {
    project: history.present.project,
    selected: history.present.selected,
    select,
    /** 操作履歴（古い順の名前と、今の位置） */
    steps: [...history.past, history.present, ...history.future].map((s) => s.label),
    stepIndex: history.past.length,
    goto,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    undo,
    redo,
    endMerge,
    replace,
    addFiles,
    addClip,
    editBlocks,
    replaceSource,
    addTrackNow,
    addTrack,
    removeTrack,
    duplicateTrack,
    insertTrack,
    updateTempo,
    addMarker,
    updateMarker,
    removeMarker,
    updateMaster,
    updateTrack,
    updateTracks,
    updateBlock,
    updateBlocks,
    removeBlocks,
    insertBlocks,
    nudgePitch,
    split,
    splitBySilence,
  }
}
