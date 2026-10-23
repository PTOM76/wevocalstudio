// 再生位置の線。再生中は毎フレーム、再生位置をブロックの頭からの拍にして返す（ブロックの外なら null）
import { useEffect, useState } from 'react'
import { projectBeatMap } from '../beats'
import type { MidiBlock, Project } from '../project'

export function usePlayBeat(o: { playing: boolean; position: () => number; project: Project; block: MidiBlock; len: number }): number | null {
  const { playing, position, project, block, len } = o
  const [beat, setBeat] = useState<number | null>(null)
  useEffect(() => {
    if (!playing) return setBeat(null)
    let id = 0
    const tick = () => {
      const m = projectBeatMap(project)
      const b = m.toBeat(position()) - m.toBeat(block.start)
      setBeat(b >= 0 && b <= len ? b : null)
      id = requestAnimationFrame(tick)
    }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
  }, [playing, block.start, len])
  return beat
}
