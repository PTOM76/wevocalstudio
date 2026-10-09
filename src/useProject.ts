// プロジェクトの状態と操作（ファイルの読み込み、トラックと波形ブロックの変更）
import { useCallback, useState } from 'react'
import { decodeFile } from 'wevocal-lib'
import { EMPTY_PROJECT, newBlock, newId, newTrack, splitBlock, type Block, type Project, type Source, type Track } from './project'

export function useProject() {
  const [project, setProject] = useState<Project>(EMPTY_PROJECT)

  /** ファイルごとにトラックを足し、先頭に波形ブロックを置く */
  const addFiles = useCallback(async (files: File[]) => {
    for (const file of files) {
      const clip = await decodeFile(file)
      const source: Source = { id: newId(), name: file.name, clip, duration: clip.channels[0].length / clip.sampleRate }
      setProject((p) => {
        const track = { ...newTrack(p.tracks.length + 1), name: file.name.replace(/\.[^.]+$/, '') }
        return { sources: [...p.sources, source], tracks: [...p.tracks, track], blocks: [...p.blocks, newBlock(track.id, source, 0)] }
      })
    }
  }, [])

  const addTrack = useCallback(() => setProject((p) => ({ ...p, tracks: [...p.tracks, newTrack(p.tracks.length + 1)] })), [])

  const updateTrack = useCallback((id: string, patch: Partial<Track>) => setProject((p) => ({ ...p, tracks: p.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)) })), [])

  const updateBlock = useCallback((id: string, patch: Partial<Block>) => setProject((p) => ({ ...p, blocks: p.blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)) })), [])

  const removeBlock = useCallback((id: string) => setProject((p) => ({ ...p, blocks: p.blocks.filter((b) => b.id !== id) })), [])

  /** 位置 t で分ける。id を渡さなければ、t にかかる波形ブロックを全部分ける */
  const split = useCallback(
    (t: number, id?: string) =>
      setProject((p) => ({ ...p, blocks: p.blocks.flatMap((b) => ((id && b.id !== id) ? [b] : splitBlock(b, t) ?? [b])) })),
    [],
  )

  return { project, addFiles, addTrack, updateTrack, updateBlock, removeBlock, split }
}
