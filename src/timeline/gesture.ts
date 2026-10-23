// 時間軸の「今どの操作中か」。押してから離すまでの操作（波形ブロックのドラッグ、範囲選択、目盛りの操作、エンベロープやオートメーションの点、MIDI ブロック、右ドラッグの枠、指のなぞり）は、同時に 1 つだけ。
// 操作ごとの状態は 1 つの判別可能な合併型（Gesture）に入れ、新しい操作を始めると前の操作は終わる（2 つが同時に立たない）
import { useRef } from 'react'
import type { Drag } from '../blockDrag'
import type { MidiDragKind } from '../midiBlocks'
import type { MidiBlock } from '../project'

/** 範囲選択のドラッグを始めた時刻と位置 */
export interface RangeDrag {
  t: number
  x: number
}
/** エンベロープの点をドラッグしている所 */
export interface EnvDrag {
  block: string
  index: number
  merge: string
}
/** ドラッグしているオートメーションの点（レーンの target と点の番号） */
export interface AutoDrag {
  target: string
  index: number
  merge: string
}
/** ドラッグしている MIDI ブロック（つかんだ所の、ブロックの左端からの px） */
export interface MidiDrag {
  id: string
  kind: MidiDragKind
  grabPx: number
  merge: string
  orig: MidiBlock
  alt: boolean
}
/** 右ドラッグの枠で選ぶ。moved なら右クリックのメニューは出さない */
export interface Marquee {
  x: number
  y: number
  moved: boolean
}
/** 空いている所を 1 本指でなぞったときのスクロール（始めた位置と、そのときの表示） */
export interface PanDrag {
  x0: number
  y0: number
  scroll0: number
  v0: number
}

export type Gesture =
  | { type: 'block'; value: Drag }
  | { type: 'range'; value: RangeDrag }
  | { type: 'scrub'; value: true }
  | { type: 'env'; value: EnvDrag }
  | { type: 'auto'; value: AutoDrag }
  | { type: 'midi'; value: MidiDrag }
  | { type: 'marquee'; value: Marquee }
  | { type: 'pan'; value: PanDrag }

type Values = { [G in Gesture as G['type']]: G['value'] }

/** 操作の種類ごとに、今の値を読み書きする窓口（`.current`）。書くと、ほかの種類の操作は終わる。null を書くと、その種類のときだけ終わる */
interface Slot<T> {
  current: T | null
}

/** 今の操作を入れる参照から、種類ごとの窓口を作る（useGestures のほか、試すときに使う） */
export function gestureSlots(gesture: { current: Gesture | null }) {
  function slot<K extends keyof Values>(type: K): Slot<Values[K]> {
    return {
      get current() {
        const g = gesture.current
        return g && g.type === type ? (g.value as Values[K]) : null
      },
      set current(v) {
        if (v === null) {
          if (gesture.current?.type === type) gesture.current = null
        } else gesture.current = { type, value: v } as Gesture
      },
    }
  }
  return {
    /** 今の操作（なければ null） */
    gesture,
    drag: slot('block'),
    rangeDrag: slot('range'),
    envDrag: slot('env'),
    autoDrag: slot('auto'),
    midiDrag: slot('midi'),
    marquee: slot('marquee'),
    pan: slot('pan'),
    /** 目盛りの上で押している間は、再生位置が付いてくる（範囲選択にしない）。false を書くと終わる */
    scrub: {
      get current() {
        return gesture.current?.type === 'scrub'
      },
      set current(on: boolean) {
        if (on) gesture.current = { type: 'scrub', value: true }
        else if (gesture.current?.type === 'scrub') gesture.current = null
      },
    },
  }
}

export function useGestures() {
  return gestureSlots(useRef<Gesture | null>(null))
}
