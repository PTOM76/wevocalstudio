// プロジェクトの状態と操作（読み込み、マスター、トラック、波形ブロックの変更）と、元に戻す、やり直す
import { useCallback, useRef, useState } from 'react'
import { decodeFile, type Clip } from 'wevocal-lib'
import { newBlock, newId, newProject, newTrack, splitBlock, type Block, type Marker, type Master, type PitchDefaults, type Project, type Source, type Tempo, type Track } from './project'

/** ピッチの範囲（半音）。2 オクターブまで */
const PITCH_MAX = 24
/** 元に戻せる回数 */
const HISTORY_MAX = 200

/** 置く場所（トラックと時刻）。省略したときは空いているトラックか、新しいトラック */
export interface DropAt {
  track: string
  start: number
}

interface History {
  past: Project[]
  present: Project
  future: Project[]
}

export function useProject(defaults: PitchDefaults) {
  const [history, setHistory] = useState<History>(() => ({ past: [], present: newProject(), future: [] }))
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
      const next = fn(h.present)
      if (next === h.present) return h
      return { past: merged ? h.past : [...h.past, h.present].slice(-HISTORY_MAX), present: next, future: [] }
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

  /** 開いたプロジェクトに入れ替える（履歴は消す） */
  const replace = useCallback((p: Project) => {
    lastMerge.current = null
    setHistory({ past: [], present: p, future: [] })
  }, [])

  /** 録った音を、指定したトラックの start 秒に波形ブロックとして置く */
  const addClip = useCallback(
    (clip: Clip, name: string, track: string, start: number) => {
      const source: Source = { id: newId(), name, clip, duration: clip.channels[0].length / clip.sampleRate }
      change((p) => ({ ...p, sources: [...p.sources, source], blocks: [...p.blocks, newBlock(track, source, start, defaultsRef.current)] }))
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

  /** 位置 t で分ける。ids が空なら、t にかかる波形ブロックを全部分ける */
  const split = useCallback(
    (t: number, ids: string[] = []) => change((p) => ({ ...p, blocks: p.blocks.flatMap((b) => (ids.length && !ids.includes(b.id) ? [b] : (splitBlock(b, t) ?? [b]))) })),
    [change],
  )

  return {
    project: history.present,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    undo,
    redo,
    endMerge,
    replace,
    addFiles,
    addClip,
    addTrackNow,
    addTrack,
    removeTrack,
    updateTempo,
    addMarker,
    updateMarker,
    removeMarker,
    updateMaster,
    updateTrack,
    updateBlock,
    updateBlocks,
    removeBlocks,
    insertBlocks,
    nudgePitch,
    split,
  }
}
