// 録音（再生位置から、ほかのトラックを鳴らしながら録り、録った音を波形ブロックとして置く。wevocal-lib の録音）
import { useState } from 'react'
import { canRecord, openInput, startRecording, type Recording } from 'wevocal-lib'
import { useT } from './i18n'
import type { Project } from './project'
import type { Settings } from './settings/settings'
import type { useProject } from './useProject'

export function useRecorder(o: {
  project: Project
  doc: ReturnType<typeof useProject>
  selectedTrack: string | null
  cursor: number
  settings: Settings
  /** 録り始めに鳴らす */
  play: () => void
  /** 録り終わりに止める */
  stopPlayer: () => void
  fail: (e: unknown) => void
}) {
  const t = useT()
  const { project, doc, selectedTrack, cursor, play, fail } = o
  const p = { settings: o.settings }
  // 録音中のものと、録り始めた位置
  const [recording, setRecording] = useState<{ rec: Recording; start: number; track: string } | null>(null)
  /** 録音を始める（再生位置から、ほかのトラックを鳴らしながら録る） */
  const startRecord = async () => {
    if (!canRecord()) return fail(t('error.noRecord'))
    try {
      // 録音待機のトラック、なければ選んでいるトラック、空いているトラック、新しいトラックの順に置く
      const track =
        project.tracks.find((tr) => tr.armed)?.id ??
        selectedTrack ??
        project.tracks.find((tr) => !project.blocks.some((b) => b.track === tr.id))?.id ??
        doc.addTrackNow()
      const rec = await startRecording(await openInput({ deviceId: p.settings.inputDevice, echoCancellation: p.settings.recordEchoCancellation, noiseSuppression: p.settings.recordNoiseSuppression, autoGainControl: p.settings.recordAutoGain }))
      setRecording({ rec, start: cursor, track })
      play()
    } catch (e) {
      fail(e)
    }
  }
  /** 録音を止めて、録った音を波形ブロックとして置く */
  const stopRecord = async () => {
    const r = recording
    if (!r) return
    setRecording(null)
    o.stopPlayer()
    try {
      const clip = await r.rec.stop()
      if (clip.channels[0]?.length) doc.addClip(clip, `${t('track.recorded')} ${new Date().toLocaleTimeString()}`, r.track, r.start)
    } catch (e) {
      fail(e)
    }
  }
  return { recording, stopRecord, toggleRecord: () => void (recording ? stopRecord() : startRecord()) }
}
