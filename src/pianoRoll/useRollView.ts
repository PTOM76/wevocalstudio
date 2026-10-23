// ピアノロールの表示の位置（左端の拍、1 拍の幅、一番下の音、1 行の高さ、折りたたみ）と、そこから決まる View。開いたとき音符が見える高さに合わせ、拡大と縮小は見えている中央を動かさない
import { useLayoutEffect, useRef, useState } from 'react'
import type { MidiBlock } from '../project'
import { KEYS, ROW_MIN, clampView, laneSpace, rowsOf, visibleBeats, type View } from './view'

export function useRollView(o: {
  block: MidiBlock
  /** ブロックの長さ（拍）と、グリッド 1 つぶん（拍） */
  len: number
  step: number
  width: number
  height: number
  /** 下のレーンの帯の高さ（0 なら隠す） */
  velH: number
  /** ドラッグしているか（折りたたみは、ドラッグの間、行がずれないよう始めたときの並びのまま） */
  dragging: () => boolean
}) {
  const { block, len, step, width, height, velH, dragging } = o
  // 表示の位置: 左端の拍、1 拍の幅（null はブロック全体が収まる幅）、一番下の音、1 行の高さ
  const [left, setLeft] = useState(0)
  const [zoom, setZoom] = useState<number | null>(null)
  const [low, setLow] = useState(48)
  // 指で操作する端末では、行を高くする
  const [row, setRow] = useState(() => (window.matchMedia?.('(pointer: coarse)').matches ? 24 : 14))
  // 折りたたみ: 音符のある高さの行だけを見せる
  const [fold, setFold] = useState(false)
  const foldRef = useRef<number[]>([])
  if (!dragging() || !foldRef.current.length) foldRef.current = [...new Set(block.notes.map((n) => n.pitch))].sort((a, b) => b - a)
  const folded = fold && foldRef.current.length ? foldRef.current : null
  const fit = Math.max(1, (width - KEYS) / Math.max(len, step * 4))
  // 行を高くして、画面を使う（高くしすぎない）
  const rowPx = folded ? Math.max(ROW_MIN, Math.min(Math.max(row, 36), Math.floor((height - laneSpace({ vel: velH })) / folded.length))) : row
  const view: View = clampView({ left, ppb: zoom ?? fit, low, row: rowPx, fold: folded, vel: velH, w: width, h: height }, len)
  const viewRef = useRef(view)
  viewRef.current = view

  // 開いたとき、音符のある高さが見えるように縦の位置を決める（音符がなければ C4 の辺り）
  const placed = useRef('')
  useLayoutEffect(() => {
    if (height < 1 || placed.current === block.id) return
    placed.current = block.id
    const ps = block.notes.map((n) => n.pitch)
    const mid = ps.length ? Math.round((Math.min(...ps) + Math.max(...ps)) / 2) : 60
    setLow(mid - Math.floor(rowsOf({ ...viewRef.current, h: height }) / 2))
  }, [block.id, height > 0])

  /** 横の拡大と縮小（見えている中央を動かさない） */
  const zoomBy = (f: number) => {
    const ppb = Math.max(2, Math.min(2000, view.ppb * f))
    const mid = view.left + visibleBeats(view) / 2
    setZoom(ppb)
    setLeft(Math.max(0, mid - visibleBeats({ ...view, ppb }) / 2))
  }

  return { view, viewRef, setLeft, setZoom, setLow, setRow, fold, setFold, zoomBy }
}
