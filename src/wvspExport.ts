// プロジェクトを WeVocalSynth のプロジェクト（.wvsp）にする。波形ブロックがあるトラックを 1 本ずつ描画して wvsp のトラックにする（memo/wvsp-export.md）
import { writeWvsp } from 'wevocal-lib'
import { renderTrack } from './engine'
import { ancestors, audible, descendants, projectEnd, type Project } from './project'

/** 書き出すトラックの id（選んだトラックとその子孫で波形ブロックがあるもの。選んでいなければ全トラック） */
export function wvspTargets(p: Project, selected: string[]): string[] {
  const picked = selected.length ? new Set(selected.flatMap((id) => [id, ...descendants(p, p.tracks.find((t) => t.id === id)!).map((t) => t.id)])) : null
  return p.tracks.filter((t) => (!picked || picked.has(t.id)) && p.blocks.some((b) => b.track === t.id)).map((t) => t.id)
}

export async function exportWvsp(p: Project, fileName: string, selected: string[], onProgress?: (v: number) => void): Promise<Blob> {
  const ids = wvspTargets(p, selected)
  const length = projectEnd(p)
  const tracks = []
  for (const [i, id] of ids.entries()) {
    const t = p.tracks.find((x) => x.id === id)!
    const clip = await renderTrack(p, id, length)
    // 先祖がミュートなら、このトラックもミュートで渡す（描画では先祖のミュートを外している）
    const mute = t.mute || ancestors(p, t).some((a) => a.mute) || !audible(p, t)
    tracks.push({ info: { name: t.name, volume: t.volume, pan: t.pan, invert: !!t.invert, mute, solo: t.solo, eq: t.eq }, original: clip, edited: clip })
    onProgress?.((i + 1) / ids.length)
  }
  return writeWvsp({ fileName, named: true, tempo: p.tempo, markers: p.markers, active: 0 }, tracks)
}
