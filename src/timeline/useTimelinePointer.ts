// 時間軸の操作（押す、動かす、離す、ダブルクリック、右クリックと長押しのメニュー、タッチ、Esc での取り消し）。ドラッグの種類ごとの状態（波形ブロック、MIDI ブロック、エンベロープの点、オートメーションの点、範囲、枠）をここで持つ
import { useEffect, useRef, useState } from 'react'
import { useDoc } from '../DocContext'
import { useEdgeScroll, useTouchGestures } from 'wevocal-lib/react'
import { fracToParam } from 'wevocal-lib'
import { useDoubleTap, useLongPress } from 'pevenmui'
import { allLanes, hitAutoPoint, laneAt } from '../autoLane'
import { hitMidi } from '../midiBlocks'
import { projectEnd, midiBlocks, songEnd } from '../project'
import { ENVELOPES, envelopeRange, hitEnvLine, hitEnvPoint } from '../envelopes'
import { snapGrid, snapToStep } from '../grid'
import { CURSOR, hitBlock } from '../blockDrag'
import { RULER, type TimelineView } from '../drawTimeline'
import type { Block, Track } from '../project'
import { localPos } from '../timeline/geometry'
import { menuHandlers } from './menuHandlers'
import { useGestures } from './gesture'
import { blockDragPatches, marqueeIds, midiDragPatch, movedAutoPoints, movedEnvPoints, rangeSelectIds } from './dragMath'
import type { TimelineProps } from '../Timeline'

/** 座標の補助（画面の y とスクロール、トラックの行、時刻）。画面を描く側とそろえるため、Timeline から受け取る */
export interface TimelineGeometry {
  cy: (y: number) => number
  trackAt: (y: number) => Track | undefined
  rowDelta: (from: number, to: number) => number
  slotAt: (y: number) => number
  toTime: (x: number) => number
  blockGeom: (b: Block) => { x: number; top: number; h: number }
}

export function useTimelinePointer(o: {
  p: TimelineProps
  canvasRef: { current: HTMLCanvasElement | null }
  view: TimelineView
  setView: (fn: (v: TimelineView) => TimelineView) => void
  /** 縦のスクロール（今の値と、変える関数、上限） */
  vs: number
  vscroll: number
  setVscroll: (v: number | ((v: number) => number)) => void
  maxRef: { current: number }
  /** 目盛りとマスターの高さ */
  top: number
  width: number
  height: number
  /** トラックの欄で高さをドラッグしているか（Esc の取り消しで merge を読む） */
  trackResizeRef: { current: { id: string; y: number; height: number; merge: string } | null }
  geo: TimelineGeometry
}) {
  const { p, canvasRef, view, setView, vs, vscroll, setVscroll, maxRef, top: TOP, width, height, trackResizeRef, geo } = o
  const { cy, trackAt, rowDelta, slotAt, toTime, blockGeom } = geo
  const doc = useDoc()
  // Shift+クリックの起点（前に押した波形ブロック）
  // 操作中の状態は 1 つ（gesture.ts）。操作を始めると前の操作は終わる
  const { drag, rangeDrag, scrub, envDrag, autoDrag, midiDrag, endDrag, marquee, pan } = useGestures()
  const anchor = useRef<string | null>(null)
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const dragCount = useRef(0)
  const [cursor, setCursor] = useState('default')

  // 目盛りのドラッグで端に来たら表示を流す（WeVocalSynth と同じ wevocal-lib の部品）。流せる先は曲の終わりの少し先まで
  const visible = width / view.pps
  const end = projectEnd(p.project)
  const edge = useEdgeScroll({
    canvasRef,
    view: { start: view.scroll, dur: visible },
    duration: Math.max(end + visible, view.scroll + visible),
    setRange: (start) => setView((v) => ({ ...v, scroll: start })),
    seek: (t) => p.onSeek(Math.max(0, t)),
  })
  // 波形ブロックのドラッグで端に来たときも流す（再生位置は動かさない）
  const blockEdge = useEdgeScroll({
    canvasRef,
    view: { start: view.scroll, dur: visible },
    duration: Math.max(end + visible, view.scroll + visible),
    setRange: (start) => setView((v) => ({ ...v, scroll: start })),
    seek: () => {},
  })
  // ドラッグを始めたときの左端の時刻と、最後に動かした位置（流れている間は指が止まっていても、ブロックが付いてくるように使う）
  const dragScroll0 = useRef(0)
  const lastMove = useRef<{ x: number; y: number; altKey: boolean; shiftKey: boolean } | null>(null)

  // ドラッグ中に Esc を押したら、そのドラッグでの変更をまとめて取り消す（始める前に戻る）。毎回の描画で最新の関数に差し替える
  const cancelDrag = () => {
    const merges = [drag.current?.merge, midiDrag.current?.merge, envDrag.current?.merge, autoDrag.current?.merge, trackResizeRef.current?.merge].filter((m): m is string => !!m)
    // 範囲のドラッグ（App の setRange の merge）と、右ドラッグの枠
    if (rangeDrag.current) merges.push('range')
    const mq = marquee.current
    if (mq) merges.push(`marquee${mq.x},${mq.y}`)
    if (!merges.length) return false
    for (const m of merges) doc.cancelMerge(m)
    rangeDrag.current = null
    touchRange.current = null
    marquee.current = null
    setBox(null)
    drag.current = null
    midiDrag.current = null
    envDrag.current = null
    autoDrag.current = null
    trackResizeRef.current = null
    lastMove.current = null
    edge.stop()
    blockEdge.stop()
    return true
  }
  const cancelDragRef = useRef(cancelDrag)
  cancelDragRef.current = cancelDrag
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // キーの割り当て（選択の解除など）より先に受け取り、取り消したときはそちらを動かさない
      if (e.key === 'Escape' && cancelDragRef.current()) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  const snapping = { mode: p.grid, division: p.division, tempo: p.project.tempo, markers: p.project.markers, pps: view.pps }
  /** 編集カーソルと範囲選択の端は、スナップが入っていればいちばん近いグリッドの線に合わせる（Shift で外す） */
  const gridAt = (x: number, shift: boolean) => {
    const t = Math.max(0, toTime(x))
    if (!p.snap || shift) return t
    const { origin, step } = snapGrid(p.grid, p.project.tempo, view.pps, p.division, p.project.markers, t)
    return Math.max(0, snapToStep(t, origin, step))
  }

  const { doubleAt, menuAt } = menuHandlers({ p, doc, view, top: TOP, geo, gridAt, marquee })

  // タッチの長押しとダブルタップ（iPhone、iPad は contextmenu と dblclick が来ない。PevenMUI。WeVocalSynth と同じ）
  const longPress = useLongPress()
  const doubleTap = useDoubleTap()
  // 2 本指のピンチで拡大縮小、目盛りはタップで移動、ドラッグで再生位置、長押しで横移動（wevocal-lib。WeVocalSynth の波形と同じ）
  const touch = useTouchGestures({
    canvasRef,
    view: { start: view.scroll, dur: width / view.pps },
    setRange: (start, dur) => setView(() => ({ scroll: Math.max(0, start), pps: Math.min(2000, Math.max(2, width / dur)) })),
    seekAt: (clientX) => p.onSeek(gridAt(localPos(canvasRef.current!, { clientX, clientY: 0 }).x, false)),
  })
  // 空いている所を 1 本指でなぞったときのスクロール（始めた位置と、そのときの表示）
  // 長押しでメニューを開いたあと（指を離しても、再生位置を移さない）
  const longPressed = useRef(false)
  // 長押しから始めた範囲選択（動かさずに離したら、メニューを出す）
  const touchRange = useRef<{ x: number; oy: number; cx: number; cy: number; moved: boolean } | null>(null)

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // 時間軸を押したら、スライダーなどに残ったフォーカスを外す（キーが時間軸の操作に届くように）
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    const { x, y: ry } = local(e)
    const y = cy(ry)
    // 2 本目の指が触れたらピンチにする（始めたドラッグはやめる）
    if (touch.down(e)) {
      longPress.cancel()
      drag.current = null
      rangeDrag.current = null
      pan.current = null
      return
    }
    if (p.selectMode && y >= RULER) {
      if (e.button !== 0) return
      e.currentTarget.setPointerCapture(e.pointerId)
      const block = y > TOP ? hitBlock(p.project, x, y, toTime, view.pps)?.block ?? hitMidi(p.project, x, y, toTime, view.pps)?.block : undefined
      if (block) {
        doc.setRange(null)
        doc.selectTracks([])
        doc.select(doc.selected.includes(block.id) ? doc.selected.filter((id) => id !== block.id) : [...doc.selected, block.id])
      } else {
        const track = trackAt(y)
        if (track) {
          doc.setRange(null)
          doc.select([])
          doc.selectTracks(doc.selectedTracks.includes(track.id) ? doc.selectedTracks.filter((id) => id !== track.id) : [...doc.selectedTracks, track.id])
        }
      }
      return
    }
    if (e.pointerType === 'touch' && y < RULER) {
      e.currentTarget.setPointerCapture(e.pointerId)
      return touch.rulerDown(e)
    }
    if (e.pointerType === 'touch') {
      // 長押しでメニューが開いても、指を離したことがここに届くようにつかんでおく（届かないと、次のタップを 2 本目の指とみなしてしまう）
      e.currentTarget.setPointerCapture(e.pointerId)
      const oy = ry
      const { clientX, clientY } = e
      longPressed.current = false
      touchRange.current = null
      longPress.start(clientX, clientY, () => {
        // 長押しになったら、始めたドラッグはやめる。離したときに再生位置も移さない
        longPressed.current = true
        drag.current = null
        midiDrag.current = null
        // 空いている所の長押し: そのままなぞると範囲選択、動かさずに離すとメニュー（波形ブロックの上は、すぐメニュー）
        if (y > TOP && !hitBlock(p.project, x, y, toTime, view.pps) && !hitMidi(p.project, x, y, toTime, view.pps)) {
          pan.current = null
          rangeDrag.current = { t: gridAt(x, false), x }
          touchRange.current = { x, oy, cx: clientX, cy: clientY, moved: false }
          navigator.vibrate?.(15)
          return
        }
        menuAt(x, oy, clientX, clientY, false)
      })
    }
    // 右ボタン: ドラッグすれば枠で選ぶ。動かさなければ右クリックのメニュー（onContextMenu）
    if (e.button === 2) {
      if (y > TOP) {
        e.currentTarget.setPointerCapture(e.pointerId)
        marquee.current = { x, y, moved: false }
      }
      return
    }
    // オートメーションの編集: レーンを出しているトラックとマスターでは、点を足す、動かす（波形ブロックの操作はしない）
    if (p.autoEdit && y >= RULER && e.pointerType !== 'touch') {
      const lane = laneAt(p.project, y)
      if (lane) {
        const pts = [...lane.points]
        let index = hitAutoPoint(lane, x, y, view.scroll, view.pps)
        const merge = `auto${dragCount.current++}`
        if (index < 0) {
          const t = Math.max(0, gridAt(x, e.shiftKey))
          index = pts.filter((pt) => pt.t <= t).length
          pts.splice(index, 0, { t, v: fracToParam(lane.def, (y - lane.top) / lane.h) })
          doc.setAutoPoints(lane.target, lane.lane.slot, lane.lane.param, pts, merge)
        }
        e.currentTarget.setPointerCapture(e.pointerId)
        autoDrag.current = { target: lane.target, index, merge }
        return
      }
    }
    const hit = y > TOP ? hitBlock(p.project, x, y, toTime, view.pps) : null
    if (y < RULER) {
      e.currentTarget.setPointerCapture(e.pointerId)
      // 曲の終わりの旗をつかんだら、終わりの位置を動かす
      if (onEndFlag(x)) {
        endDrag.current = { merge: `end${dragCount.current++}` }
        return
      }
      scrub.current = true
      p.onSeek(gridAt(x, e.shiftKey))
      return
    }
    // MIDI ブロック（波形ブロックがない所）: 選んで、動かす、端で長さを変える
    if (!hit && y > TOP && !p.envKind && !p.autoEdit) {
      const mh = hitMidi(p.project, x, y, toTime, view.pps, e.pointerType === 'touch' ? 18 : undefined)
      if (mh) {
        doc.select([mh.block.id])
        p.onSelectTrack(mh.block.track)
        e.currentTarget.setPointerCapture(e.pointerId)
        midiDrag.current = { id: mh.block.id, kind: mh.kind, grabPx: x - (mh.block.start - view.scroll) * view.pps, merge: `midi${dragCount.current++}`, orig: mh.block, alt: e.altKey }
        return
      }
    }
    // タッチで空いている所: なぞるとスクロール（長押しはメニュー）
    if (!hit && e.pointerType === 'touch') {
      const track = trackAt(y)
      if (track) p.onSelectTrack(track.id)
      e.currentTarget.setPointerCapture(e.pointerId)
      pan.current = { x0: e.clientX, y0: e.clientY, scroll0: view.scroll, v0: vscroll }
      return
    }
    if (!hit) {
      // 空いている所: 押しただけなら再生位置、ドラッグしたら範囲選択（範囲を選ぶときは再生位置を動かさないよう、再生位置は離したときに移す）
      if (!e.ctrlKey && !e.metaKey) doc.select([])
      const track = trackAt(y)
      if (track) p.onSelectTrack(track.id)
      e.currentTarget.setPointerCapture(e.pointerId)
      rangeDrag.current = { t: gridAt(x, e.shiftKey), x }
      return
    }
    const id = hit.block.id
    // エンベロープを出しているときは、点を足すか動かす
    // 選択の道具のときは、線か点を押したときだけ（それ以外は波形ブロックの操作）
    const envB = hit.block
    const envG = blockGeom(envB)
    const envRange = p.envKind ? envelopeRange(p.envKind, envB, p.envKind === 'pitch' ? p.pitchEnvelopeRange : p.envelopeRange) : 0
    const onEnv = !!p.envKind && (p.envPen || hitEnvPoint(p.envKind, envB, x, y, envG.x, envG.top, envG.h, view.pps, envRange) >= 0 || hitEnvLine(p.envKind, envB, x, y, envG.x, envG.top, envG.h, view.pps, envRange))
    if (p.envKind && onEnv && !e.altKey) {
      const b = hit.block
      const g = blockGeom(b)
      const spec = ENVELOPES[p.envKind]
      const env = spec.points(b)
      const range = envRange
      let index = hitEnvPoint(p.envKind, b, x, y, g.x, g.top, g.h, view.pps, range)
      if (index < 0) {
        const t = Math.max(0, Math.min(b.length, (x - g.x) / view.pps))
        index = env.filter((pt) => pt.t <= t).length
        env.splice(index, 0, { t, v: spec.value((y - g.top) / g.h, range) })
        doc.updateBlock(b.id, spec.patch(b, env), `env${dragCount.current}`)
      }
      doc.select([b.id])
      e.currentTarget.setPointerCapture(e.pointerId)
      envDrag.current = { block: b.id, index, merge: `env${dragCount.current++}` }
      return
    }
    // Shift: 起点から押したものまでの、トラックと時間の範囲の波形ブロックを選ぶ
    const from = anchor.current && p.project.blocks.find((b) => b.id === anchor.current)
    if (e.shiftKey && from) {
      doc.select(rangeSelectIds(p.project, from, hit.block))
      return
    }
    anchor.current = id
    // 押した所に再生位置を移す。端（長さを変える所）ならその端
    if (!e.ctrlKey && !e.metaKey) {
      const b = hit.block
      const t = hit.kind === 'left' || hit.kind === 'fadeIn' ? b.start : hit.kind === 'right' || hit.kind === 'fadeOut' ? b.start + b.length : toTime(x)
      const snapped = hit.kind === 'move' ? gridAt(x, e.shiftKey) : t
      p.onCursor(Math.max(0, snapped))
    }
    // 選んでいるものをつまんだら、選んだもの全部を動かす。Ctrl は、動かせば複製、動かさずに離せば選択の足し引き
    const ctrl = e.ctrlKey || e.metaKey
    const wasSelected = doc.selected.includes(id)
    const group = wasSelected ? doc.selected : ctrl ? [...doc.selected, id] : [id]
    doc.select(group)
    p.onSelectTrack(hit.block.track)
    e.currentTarget.setPointerCapture(e.pointerId)
    const trackIndex = p.project.tracks.findIndex((t) => t.id === hit.block.track)
    const others = ['move', 'left', 'right'].includes(hit.kind) ? p.project.blocks.filter((b) => group.includes(b.id) && b.id !== id) : []
    dragScroll0.current = view.scroll
    lastMove.current = null
    drag.current = { kind: hit.kind, block: hit.block, others, x, y, trackIndex, merge: `drag${dragCount.current++}`, copy: ctrl && hit.kind === 'move' ? { wasSelected, done: false } : undefined }
  }

  /** ドラッグ中の波形ブロックを、指の位置（と流れた分）に合わせて動かす */
  const moveDrag = (d: NonNullable<typeof drag.current>, x: number, y: number, altKey: boolean, shiftKey: boolean) => {
    // Ctrl で始めたら、動かし始めたときに写しをその場に残す（動かすのは元のもの）
    if (d.copy && !d.copy.done) {
      if (Math.hypot(x - d.x, y - d.y) < 4) return
      d.copy.done = true
      p.onCopyBlocks([d.block, ...d.others])
    }
    const raw = (x - d.x) / view.pps + (view.scroll - dragScroll0.current)
    const patches = blockDragPatches(p.project, d, raw, rowDelta(d.y, y), { altKey, shiftKey, snap: p.snap, cursor: p.cursor, snapping })
    doc.updateBlocks(patches, d.merge)
  }

  /** ドラッグしている MIDI ブロックを、指の位置に合わせて動かす（波形ブロックと同じく、縦に動かすとほかのトラックへ移り、端で表示が流れる） */
  const moveMidi = (md: NonNullable<typeof midiDrag.current>, x: number, y: number, shiftKey: boolean) => {
    const b = midiBlocks(p.project).find((q) => q.id === md.id)
    if (!b) return
    doc.updateMidiBlock(b.id, midiDragPatch(p.project, md, b, x, trackAt(y)?.id, (gx) => gridAt(gx, shiftKey)), md.merge)
  }

  // 端で表示が流れている間は、指が動かなくても波形ブロックと MIDI ブロックを付いてこさせる
  useEffect(() => {
    const d = drag.current
    const m = lastMove.current
    if (d && m) moveDrag(d, m.x, m.y, m.altKey, m.shiftKey)
    else if (midiDrag.current && m) moveMidi(midiDrag.current, m.x, m.y, m.shiftKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.scroll])

  /** 目盛りの上で、曲の終わりの旗（線の左の三角を含む）を押したか */
  const onEndFlag = (x: number) => {
    const last = songEnd(p.project)
    if (last <= 0) return false
    const ex = (last - view.scroll) * view.pps
    return x >= ex - 11 && x <= ex + 4
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    longPress.move(e.clientX, e.clientY)
    if (touch.move(e)) return
    const { x, y: ry } = local(e)
    const y = cy(ry)
    if (p.selectMode && y >= RULER) return
    const pn = pan.current
    if (pn) {
      setView((v) => ({ ...v, scroll: Math.max(0, pn.scroll0 - (e.clientX - pn.x0) / v.pps) }))
      setVscroll(Math.max(0, Math.min(maxRef.current, pn.v0 - (e.clientY - pn.y0))))
      return
    }
    const md = midiDrag.current
    if (md) {
      // 端に来たら表示を流し、上下の端では縦にスクロールする（波形ブロックと同じ）
      blockEdge.update(e.clientX)
      const oy = ry
      if (oy > height - 24) setVscroll((v) => Math.min(maxRef.current, v + 8))
      else if (oy > TOP && oy < TOP + 24) setVscroll((v) => Math.max(0, v - 8))
      lastMove.current = { x, y, altKey: e.altKey, shiftKey: e.shiftKey }
      return moveMidi(md, x, y, e.shiftKey)
    }
    const ad = autoDrag.current
    if (ad) {
      const lane = allLanes(p.project).find((l) => l.target === ad.target)
      if (!lane || !lane.points[ad.index]) return
      const pts = movedAutoPoints(lane, ad.index, y, gridAt(x, e.shiftKey))
      if (!pts) return
      return doc.setAutoPoints(lane.target, lane.lane.slot, lane.lane.param, pts, ad.merge)
    }
    const ed = envDrag.current
    if (ed) {
      const b = p.project.blocks.find((x) => x.id === ed.block)
      if (!b || !p.envKind) return
      const spec = ENVELOPES[p.envKind]
      const range = envelopeRange(p.envKind, b, p.envKind === 'pitch' ? p.pitchEnvelopeRange : p.envelopeRange)
      const env = movedEnvPoints(spec, b, ed.index, x, y, blockGeom(b), view.pps, range)
      if (!env) return
      return doc.updateBlock(b.id, spec.patch(b, env), ed.merge)
    }
    const mq = marquee.current
    if (mq) {
      if (!mq.moved && Math.hypot(x - mq.x, y - mq.y) < 4) return
      mq.moved = true
      // 枠の表示は画面の位置（スクロールした分を引く）
      const sy = (v: number) => (v >= TOP ? v - vs : v)
      setBox({ x0: Math.min(mq.x, x), y0: sy(Math.min(mq.y, y)), x1: Math.max(mq.x, x), y1: sy(Math.max(mq.y, y)) })
      // 枠にかかる波形ブロックを選ぶ
      doc.select(marqueeIds(p.project, mq.x, mq.y, x, y, toTime, slotAt), `marquee${mq.x},${mq.y}`)
      return
    }
    if (endDrag.current) {
      return doc.setEnd(Math.max(0, gridAt(x, e.shiftKey)), endDrag.current.merge)
    }
    if (scrub.current) {
      edge.update(e.clientX)
      return p.onSeek(gridAt(x, e.shiftKey))
    }
    const r = rangeDrag.current
    if (r) {
      if (Math.abs(x - r.x) < 3) return
      if (touchRange.current) touchRange.current.moved = true
      const snapped = gridAt(x, e.shiftKey)
      doc.setRange({ start: Math.min(r.t, snapped), end: Math.max(r.t, snapped) })
      return
    }
    const d = drag.current
    if (!d) {
      // つまめる所でカーソルの形を変える
      if (y < RULER && onEndFlag(x)) return setCursor('ew-resize')
      const hit = y > TOP ? hitBlock(p.project, x, y, toTime, view.pps) ?? hitMidi(p.project, x, y, toTime, view.pps) : null
      setCursor(hit ? CURSOR[hit.kind] : 'default')
      return
    }
    blockEdge.update(e.clientX)
    const oy = ry
    if (oy > height - 24) setVscroll((v) => Math.min(maxRef.current, v + 8))
    else if (oy > TOP && oy < TOP + 24) setVscroll((v) => Math.max(0, v - 8))
    lastMove.current = { x, y, altKey: e.altKey, shiftKey: e.shiftKey }
    moveDrag(d, x, y, e.altKey, e.shiftKey)
  }

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    longPress.cancel()
    if (touch.up(e)) return
    if (p.selectMode && cy(local(e).y) >= RULER) return
    // なぞらずに離したら、押した所へ再生位置を移す
    const pn = pan.current
    pan.current = null
    if (pn && !longPressed.current && Math.hypot(e.clientX - pn.x0, e.clientY - pn.y0) < 8) {
      doc.select([])
      p.onSeek(gridAt(local(e).x, false))
    }
    if (e.pointerType === 'touch' && doubleTap.tap(e.clientX, e.clientY)) doubleAt(local(e).x, local(e).y)
    envDrag.current = null
    autoDrag.current = null
    midiDrag.current = null
    // 長押しから始めた範囲選択を、動かさずに離したら、そこにメニューを出す
    const tr = touchRange.current
    touchRange.current = null
    if (tr && !tr.moved) {
      rangeDrag.current = null
      menuAt(tr.x, tr.oy, tr.cx, tr.cy, false)
    }
    if (marquee.current) {
      // 動かしたら、このあとの右クリックのメニューは出さない
      if (!marquee.current.moved) marquee.current = null
      setBox(null)
    }
    // 範囲を作らずに離したら、範囲を消す
    if (rangeDrag.current && Math.abs(local(e).x - rangeDrag.current.x) < 3) {
      doc.setRange(null)
      p.onSeek(gridAt(rangeDrag.current.x, e.shiftKey))
    }
    // Ctrl で押して動かさずに離したら、選択の足し引き（選んでいたものは外す）
    const d = drag.current
    if (d?.copy && !d.copy.done && d.copy.wasSelected) doc.select(doc.selected.filter((s) => s !== d.block.id))
    rangeDrag.current = null
    endDrag.current = null
    scrub.current = false
    edge.stop()
    blockEdge.stop()
    lastMove.current = null
    drag.current = null
    doc.endMerge()
  }
  const local = (e: { clientX: number; clientY: number }) => localPos(canvasRef.current!, e)
  return { box, cursor, onPointerDown, onPointerMove, onPointerUp, doubleAt, menuAt }
}
