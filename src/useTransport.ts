// 再生と編集カーソル。再生（Player）、再生中か、編集カーソル（押した所、貼り付ける所）、再生カーソル、一時停止の位置、繰り返しを持ち、再生、一時停止、停止、移動の操作を渡す
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Range } from 'wevocal-lib'
import { Player } from './engine'
import type { Project } from './project'

export interface TransportOptions {
  project: Project
  range: Range | null
  setRange: (r: Range | null) => void
  fail: (e: unknown) => void
  /** 重いプラグインを先に計算して鳴らす設定（変わったら先読みをやり直す） */
  anticipativeFx: boolean
  /** 録音しているか、録音を止める（停止ボタンは、録音中なら録音を止める。録音の側が play を使うので、あとから入れる） */
  recorder: { current: { recording: boolean; stop: () => void } | null }
}

export function useTransport({ project, range, setRange, fail, anticipativeFx, recorder }: TransportOptions) {
  const player = useRef(new Player())
  const [playing, setPlaying] = useState(false)
  // 編集カーソル（押した所、貼り付ける所。再生では動かない）と、再生カーソル（再生中と一時停止中だけ。 2 本）
  const [cursor, setCursor] = useState(0)
  const [playPos, setPlayPos] = useState<number | null>(null)
  // 一時停止した位置（編集カーソルを動かしたら消す）
  const [paused, setPaused] = useState<number | null>(null)
  const [repeat, setRepeat] = useState(false)

  // 止めている間に、鳴らし始める位置から先の FX の音を先に作っておく（最後の操作から少し待つ。memo/fx-cache.md）
  useEffect(() => {
    if (playing) return
    const h = setTimeout(() => void player.current.warm(project, paused ?? cursor), 1500)
    return () => {
      clearTimeout(h)
      // 編集したら、前のプロジェクトで作っている準備はすぐやめる（作っている途中のかたまりだけは終わるまで待つ）
      player.current.cancelWarm()
    }
  }, [project, cursor, paused, playing, anticipativeFx])

  // 再生中の位置は状態に入れず、描く所が毎フレーム読む（画面全体を毎フレーム描き直さないように。WeVocalSynth と同じ）
  const livePos = useCallback(() => (player.current.playing ? player.current.position() : playPos), [playPos])

  /** from 秒から鳴らし始める（一時停止の印は消す） */
  const startAt = (from: number) => {
    setPaused(null)
    setPlayPos(from)
    void player.current.play(project, from).then(() => player.current.playing && setPlaying(true)).catch(fail)
  }

  const play = () => {
    // 一時停止していたらそこから。範囲選択があれば、その中だけを鳴らす（外にいたら範囲の頭から）
    const at = paused ?? cursor
    startAt(range && (at < range.start || at >= range.end) ? range.start : at)
  }

  /** start〜end 秒だけを再生する（ピアノロールの再生）。範囲として選び、loop なら繰り返す */
  const playRange = (start: number, end: number, loop: boolean, from = start) => {
    setRange({ start, end })
    setRepeat(loop)
    startAt(from)
  }

  /**
   * ピアノロールの再生。メインの再生と同じく、範囲選択か編集位置がそのブロックの中にあれば、そこから鳴らす（範囲があれば範囲の中だけ）。
   * なければ、ブロックの範囲を鳴らす。loop なら繰り返す
   */
  const playRoll = (start: number, end: number, loop: boolean) => {
    const inRange = !!range && range.end > start && range.start < end
    if (!inRange && !(cursor >= start && cursor < end)) return playRange(start, end, loop)
    // 編集位置から繰り返すときは、ブロックの範囲を選んで（終わりで折り返すため）編集位置から鳴らす
    if (loop && !inRange) return playRange(start, end, true, cursor)
    setRepeat(loop)
    play()
  }

  /** 一時停止。再生カーソルはその場に残す */
  const pause = () => {
    const pos = player.current.position()
    player.current.stop()
    setPaused(pos)
    setPlayPos(pos)
    setPlaying(false)
  }

  /** 停止。再生カーソルを消す（編集カーソルはそのまま。次の再生はそこから）。録音中なら録音を止める */
  const stop = () => {
    if (recorder.current?.recording) return recorder.current.stop()
    player.current.stop()
    setPlaying(false)
    setPaused(null)
    setPlayPos(null)
  }

  /** 編集カーソルだけを動かす（波形ブロックを押したとき、コピー、貼り付け） */
  const moveCursor = (time: number) => {
    setCursor(time)
    setPaused(null)
  }

  /** 編集カーソルを動かし、再生中なら再生もそこへ（目盛りと空いている所） */
  const seek = (time: number) => {
    moveCursor(time)
    if (playing) {
      void player.current.play(project, time).catch(fail)
      setPlayPos(time)
    } else setPlayPos(null)
  }

  return { player, playing, setPlaying, cursor, setCursor, playPos, setPlayPos, paused, setPaused, repeat, setRepeat, livePos, startAt, play, playRange, playRoll, pause, stop, moveCursor, seek }
}
