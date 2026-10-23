// 時間軸の、ダブルクリック（タッチはダブルタップ）と、右クリック（タッチは長押し）のメニュー。押した所に何があるかで、波形ブロックの操作、エンベロープの点、マーカー、何もない所の操作に振り分ける

import { hitAutoPoint, laneAt } from '../autoLane'
import { hitMidi } from '../midiBlocks'
import { ENVELOPES, envelopeRange, hitEnvLine, hitEnvPoint } from '../envelopes'
import { hitBlock } from '../blockDrag'
import { RULER, type TimelineView } from '../drawTimeline'
import type { TimelineProps } from '../Timeline'
import type { ProjectApi } from '../DocContext'
import type { TimelineGeometry } from './useTimelinePointer'

export function menuHandlers(c: {
  p: TimelineProps
  doc: ProjectApi
  view: TimelineView
  /** 目盛りとマスターの高さ */
  top: number
  geo: TimelineGeometry
  /** 編集カーソルと範囲選択の端を、スナップが入っていればグリッドの線に合わせた時刻（Shift で外す） */
  gridAt: (x: number, shift: boolean) => number
  /** 右ドラッグの枠（動かしたら、このあとの右クリックのメニューは出さない） */
  marquee: { current: { x: number; y: number; moved: boolean } | null }
}) {
  const { p, doc, view, top: TOP, geo, gridAt, marquee } = c
  const { cy, trackAt, toTime, blockGeom } = geo
  /** 目盛りの上で、x にあるマーカー（旗の幅の中か、線の近く） */
  const markerAtX = (x: number) =>
    p.project.markers.find((m) => {
      const mx = (m.time - view.scroll) * view.pps
      return x >= mx - 4 && x <= mx + 60
    })

  /** ダブルクリック（タッチはダブルタップ）。波形ブロックはプロパティ、エンベロープの点は消す、マーカーは編集 */
  const doubleAt = (x: number, oy: number) => {
    const y = cy(oy)
    // オートメーションの点のダブルクリックは、その点を消す
    if (p.autoEdit && y >= RULER) {
      const lane = laneAt(p.project, y)
      const i = lane ? hitAutoPoint(lane, x, y, view.scroll, view.pps) : -1
      if (lane && i >= 0) return doc.setAutoPoints(lane.target, lane.lane.slot, lane.lane.param, lane.points.filter((_, k) => k !== i))
    }
    if (y > TOP) {
      const hit = hitBlock(p.project, x, y, toTime, view.pps)
      // MIDI ブロックのダブルクリックは、ピアノロールを開く
      const mh = !hit && hitMidi(p.project, x, y, toTime, view.pps)
      if (mh) return p.onMidiEdit(mh.block.id)
      if (!hit) return
      // エンベロープの点のダブルクリックは、その点を消す
      if (p.envKind) {
        const g = blockGeom(hit.block)
        const spec = ENVELOPES[p.envKind]
        const range = envelopeRange(p.envKind, hit.block, p.envKind === 'pitch' ? p.pitchEnvelopeRange : p.envelopeRange)
        const i = hitEnvPoint(p.envKind, hit.block, x, y, g.x, g.top, g.h, view.pps, range)
        if (i >= 0) return doc.updateBlock(hit.block.id, spec.patch(hit.block, spec.points(hit.block).filter((_, k) => k !== i)))
      }
      p.onProperties(hit.block.id)
      return
    }
    if (y >= RULER) return
    // 旗の幅の中か、線の近く
    const m = markerAtX(x)
    if (m) p.onMarkerEdit(m.id)
  }

  /** 右クリック（タッチは長押し）のメニュー。押した所が波形ブロックならその操作、空いている所ならその場所の操作 */
  const menuAt = (x: number, oy: number, cx: number, cyClient: number, shift: boolean) => {
    if (marquee.current?.moved) {
      marquee.current = null
      return
    }
    marquee.current = null
    const y = cy(oy)
    const hit = y > TOP ? hitBlock(p.project, x, y, toTime, view.pps) : null
    const mh = !hit && y > TOP ? hitMidi(p.project, x, y, toTime, view.pps) : null
    if (mh) {
      if (!doc.selected.includes(mh.block.id)) doc.select([mh.block.id])
      p.onSelectTrack(mh.block.track)
      return p.onBlockMenu(mh.block.id, cx, cyClient)
    }
    if (!hit) {
      const track = y > TOP ? (trackAt(y)?.id ?? null) : null
      if (track) p.onSelectTrack(track)
      // 目盛りの上のマーカー（旗の幅の中か、線の近く）を押したら、そのマーカーの操作もメニューに出す
      const mk = y < RULER ? markerAtX(x) : undefined
      return p.onEmptyMenu(y < RULER ? 'ruler' : 'lane', gridAt(x, shift), track, cx, cyClient, mk?.id)
    }
    if (!doc.selected.includes(hit.block.id)) doc.select([hit.block.id])
    p.onSelectTrack(hit.block.track)
    // エンベロープの線か点の上なら、エンベロープのメニュー
    if (p.envKind) {
      const g = blockGeom(hit.block)
      const range = envelopeRange(p.envKind, hit.block, p.envKind === 'pitch' ? p.pitchEnvelopeRange : p.envelopeRange)
      const index = hitEnvPoint(p.envKind, hit.block, x, y, g.x, g.top, g.h, view.pps, range)
      if (index >= 0 || hitEnvLine(p.envKind, hit.block, x, y, g.x, g.top, g.h, view.pps, range)) return p.onEnvMenu(hit.block.id, index, cx, cyClient)
    }
    p.onBlockMenu(hit.block.id, cx, cyClient)
  }
  return { doubleAt, menuAt }
}
