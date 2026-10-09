// プロジェクトの状態と操作（ファイルの読み込み、マスター、トラック、波形ブロックの変更）
import { useCallback, useRef, useState } from 'react'
import { decodeFile } from 'wevocal-lib'
import { newBlock, newId, newProject, newTrack, splitBlock, type Block, type Master, type PitchDefaults, type Project, type Source, type Track } from './project'

/** ピッチの範囲（半音）。2 オクターブまで */
const PITCH_MAX = 24

/** 置く場所（トラックと時刻）。省略したときは空いているトラックか、新しいトラック */
export interface DropAt {
  track: string
  start: number
}

export function useProject(defaults: PitchDefaults) {
  const [project, setProject] = useState<Project>(newProject)
  // 読み込みの途中で設定が変わっても、最新の既定値を使う
  const defaultsRef = useRef(defaults)
  defaultsRef.current = defaults

  /** ファイルを読み込んで波形ブロックとして置く。場所を指定したら、そのトラックに続けて並べる */
  const addFiles = useCallback(async (files: File[], at?: DropAt) => {
    let start = at?.start ?? 0
    for (const file of files) {
      const clip = await decodeFile(file)
      const source: Source = { id: newId(), name: file.name, clip, duration: clip.channels[0].length / clip.sampleRate }
      const name = file.name.replace(/\.[^.]+$/, '')
      const begin = start
      setProject((p) => {
        let tracks = p.tracks
        let track = at && tracks.find((t) => t.id === at.track)
        if (!track) {
          // 波形ブロックのない最初のトラックを使い、なければ足す
          track = tracks.find((t) => !p.blocks.some((b) => b.track === t.id))
          if (!track) {
            track = newTrack(tracks.length + 1)
            tracks = [...tracks, track]
          }
          // 空のトラックの名前はファイルの名前にする
          const id = track.id
          tracks = tracks.map((t) => (t.id === id ? { ...t, name } : t))
          track = { ...track, name }
        }
        return { ...p, sources: [...p.sources, source], tracks, blocks: [...p.blocks, newBlock(track.id, source, begin, defaultsRef.current)] }
      })
      if (at) start += source.duration
    }
  }, [])

  const addTrack = useCallback(() => setProject((p) => ({ ...p, tracks: [...p.tracks, newTrack(p.tracks.length + 1)] })), [])

  const updateMaster = useCallback((patch: Partial<Master>) => setProject((p) => ({ ...p, master: { ...p.master, ...patch } })), [])

  const updateTrack = useCallback((id: string, patch: Partial<Track>) => setProject((p) => ({ ...p, tracks: p.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)) })), [])

  const updateBlock = useCallback((id: string, patch: Partial<Block>) => setProject((p) => ({ ...p, blocks: p.blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)) })), [])

  const removeBlock = useCallback((id: string) => setProject((p) => ({ ...p, blocks: p.blocks.filter((b) => b.id !== id) })), [])

  /** ピッチを delta 半音だけ変える。delta が null なら 0 に戻す。小数の誤差は 0.01 半音（1 セント）に丸める */
  const nudgePitch = useCallback(
    (id: string, delta: number | null) =>
      setProject((p) => ({
        ...p,
        blocks: p.blocks.map((b) => (b.id === id ? { ...b, pitch: delta === null ? 0 : Math.max(-PITCH_MAX, Math.min(PITCH_MAX, Math.round((b.pitch + delta) * 100) / 100)) } : b)),
      })),
    [],
  )

  /** 位置 t で分ける。id を渡さなければ、t にかかる波形ブロックを全部分ける */
  const split = useCallback(
    (t: number, id?: string) => setProject((p) => ({ ...p, blocks: p.blocks.flatMap((b) => (id && b.id !== id ? [b] : (splitBlock(b, t) ?? [b]))) })),
    [],
  )

  return { project, addFiles, addTrack, updateMaster, updateTrack, updateBlock, removeBlock, nudgePitch, split }
}
