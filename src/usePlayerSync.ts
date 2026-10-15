// 再生中の同期。範囲や曲の終わりで止める、再生中に変えたものを音に反映する、ピッチを変えた音を用意してゲージを動かす
import { useEffect, useRef } from 'react'
import { startJob } from 'pevenmui'
import type { Range } from 'wevocal-lib'
import { onPitchProgress, pitchProgress, preparePitch } from './dsp/pitch'
import type { Player } from './engine'
import { useT } from './i18n'
import type { Project } from './project'

export function usePlayerSync(o: {
  player: Player
  project: Project
  cursor: number
  playing: boolean
  range: Range | null
  repeat: boolean
  /** 波形ブロックがある最後の位置 */
  end: number
  setPlayPos: (t: number | null) => void
  setPlaying: (v: boolean) => void
  fail: (e: unknown) => void
  /** ピッチを変えた音ができたとき（解析の欄が作り直す） */
  onMade: () => void
}) {
  const t = useT()
  const { project, cursor, playing, range, repeat, end, setPlayPos, setPlaying, fail } = o
  const player = { current: o.player }
  const setMadeVersion = (_: (v: number) => number) => o.onMade()
  // 再生中は位置を動かす
  useEffect(() => {
    if (!playing) return
    let id = 0
    const tick = () => {
      const pos = player.current.position()
      // 範囲の終わりで止める。リピートなら範囲の頭に戻る
      if (range && pos >= range.end) {
        if (repeat) {
          void player.current.play(project, range.start).catch(fail)
          setPlayPos(range.start)
        } else {
          player.current.stop()
          setPlayPos(null)
          setPlaying(false)
          return
        }
      } else if (!range && end > 0 && pos >= end) {
        if (repeat) {
          // 範囲がないリピートは、曲の終わりまで行ったら最初に戻る
          void player.current.play(project, 0).catch(fail)
          setPlayPos(0)
        } else {
          // 曲の終わり（最後の波形ブロックの終わり）で止める
          player.current.stop()
          setPlayPos(null)
          setPlaying(false)
          return
        }
      }
      id = requestAnimationFrame(tick)
    }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
  }, [playing, range, repeat, project, end])


  const projectRef = useRef(project)
  projectRef.current = project

  // 再生中に変えた値を音に反映する（変わったトラックの声だけをミキサーに送る）
  const replay = () => player.current.update(projectRef.current)
  // 続けて変えている間（ドラッグなど）は 50ms に 1 回まで送る（最後の変更は必ず送る）
  const lastReplay = useRef(0)
  useEffect(() => {
    if (!player.current.playing) return
    const wait = Math.max(0, lastReplay.current + 50 - performance.now())
    const id = setTimeout(() => {
      lastReplay.current = performance.now()
      replay()
    }, wait)
    return () => clearTimeout(id)
    // project が変わったときだけ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project])
  // かたまりが 1 つできるたびに、ゲージを動かし、再生中ならその波形ブロックを差し替え、時間軸の「処理中」を描き直す（表示はまとめて 0.1 秒に 1 回）
  useEffect(() => {
    let timer = 0
    let lastDone = 0
    let lastSent = 0
    let queued = false
    let pitchJob: ReturnType<typeof startJob> | null = null
    return onPitchProgress(() => {
      // 鳴らす音はタイマーを待たずに差し替える（ウィンドウが隠れているとタイマーが間引かれ、できた所が鳴らないため）
      const whole = Math.floor(pitchProgress().done)
      if (whole !== lastSent && !queued) {
        queued = true
        queueMicrotask(() => {
          queued = false
          lastSent = Math.floor(pitchProgress().done)
          if (player.current.playing) player.current.update(projectRef.current)
        })
      }
      if (timer) return
      timer = window.setTimeout(() => {
        timer = 0
        const pr = pitchProgress()
        // ピッチなどを作っている間はゲージに出す
        if (pr.total > 0) {
          pitchJob ??= startJob('pitch', t('job.pitch'))
          pitchJob.update(pr.done / pr.total)
        } else {
          pitchJob?.end()
          pitchJob = null
        }
        // できたかたまりが増えていれば鳴らす音を差し替える
        const whole = Math.floor(pr.done)
        if (whole !== lastDone) {
          lastDone = whole
          setMadeVersion((v) => v + 1)
        }
      }, 100)
    })
  }, [])

  // 再生中は 1 秒ごとに、今の再生位置に近い所から作り直すよう頼み直す（画面が止まっていても、通り過ぎた所を作り続けないように）
  useEffect(() => {
    if (!playing) return
    const id = setInterval(() => {
      preparePitch(projectRef.current, player.current.position()).catch(() => {})
    }, 1000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing])

  // ピッチを変えた音を用意する（再生位置か編集カーソルに近い所から。できたかたまりから鳴らす）。
  // 再生位置を変えたら（cursor が変わる）、新しい位置に近い所から頼み直す。でないと、前の位置の近くを作り終えるまで、新しい位置は鳴らない
  useEffect(() => {
    let alive = true
    preparePitch(project, player.current.playing ? player.current.position() : cursor)
      .then((made) => {
        if (!alive || !made) return
        replay()
        setMadeVersion((v) => v + 1)
      })
      .catch((e: unknown) => alive && fail(e))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, cursor])

}
