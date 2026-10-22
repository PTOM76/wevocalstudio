// 録音（再生位置から、ほかのトラックを鳴らしながら録り、録った音を波形ブロックとして置く。wevocal-lib の録音）
import { useRef, useState } from 'react'
import { fillMidi, newId } from './project'
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
  /** 再生の今の位置（秒。MIDI の音符の時刻に使う） */
  position: () => number
  fail: (e: unknown) => void
}) {
  const t = useT()
  const { project, doc, selectedTrack, cursor, play, fail } = o
  const p = { settings: o.settings }
  // 録音中のものと、録り始めた位置
  const [recording, setRecording] = useState<{ rec: Recording; start: number; track: string } | null>(null)
  // MIDI を録っているもの（音源のあるトラックで録音を始めたとき）。弾いた音符を、再生の位置から曲の時刻にして溜める
  const [midiRec, setMidiRec] = useState<{ track: string; start: number } | null>(null)
  const take = useRef<{ notes: { abs: number; dur: number; pitch: number; vel: number }[]; down: Map<number, { abs: number; vel: number }> }>({ notes: [], down: new Map() })
  /** 弾いた音を録る（録っていなければ何もしない） */
  const onMidiNote = (pitch: number, vel: number, on: boolean) => {
    if (!midiRec) return
    const now = o.position()
    if (on) take.current.down.set(pitch, { abs: now, vel })
    else {
      const d = take.current.down.get(pitch)
      if (!d) return
      take.current.down.delete(pitch)
      take.current.notes.push({ abs: d.abs, dur: Math.max(0.02, now - d.abs), pitch, vel: d.vel })
    }
  }
  /** MIDI の録音を止めて、弾いた音符を MIDI ブロックとして置く */
  const stopMidiRecord = () => {
    const r = midiRec
    if (!r) return
    setMidiRec(null)
    // 止める前の位置（止めると位置が戻る）
    const now = o.position()
    o.stopPlayer()
    // 離していない音は、止めた所までにする
    for (const [pitch, d] of take.current.down) take.current.notes.push({ abs: d.abs, dur: Math.max(0.02, now - d.abs), pitch, vel: d.vel })
    const notes = take.current.notes
    take.current = { notes: [], down: new Map() }
    if (!notes.length) return
    const start = Math.min(...notes.map((n) => n.abs))
    const end = Math.max(...notes.map((n) => n.abs + n.dur))
    doc.addMidiBlock(fillMidi({ id: newId(), track: r.track, start, length: Math.max(0.25, end - start), mute: false, notes: notes.map((n) => ({ id: newId(), t: n.abs - start, dur: n.dur, pitch: n.pitch, vel: n.vel })) }, project.tempo, project.markers))
  }
  // 録音中の波形ブロックの表示用（録り始めからの秒と振幅を、描くたびに足す）
  const bars = useRef<[number, number][]>([])
  /** 録っている最中の波形ブロックの様子。録っていなければ null。呼ぶたびに最新の振幅を足す */
  const live = () => {
    if (!recording) return null
    const seconds = recording.rec.seconds()
    const last = bars.current[bars.current.length - 1]
    if (!last || seconds > last[0]) bars.current.push([seconds, recording.rec.peak()])
    return { track: recording.track, start: recording.start, seconds, bars: bars.current }
  }
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
      // 音源のあるトラックなら、音ではなく弾いた音符（MIDI）を録る
      if (project.tracks.find((tr) => tr.id === track)?.instrument) {
        take.current = { notes: [], down: new Map() }
        setMidiRec({ track, start: cursor })
        play()
        return
      }
      const rec = await startRecording(await openInput({ deviceId: p.settings.inputDevice, echoCancellation: p.settings.recordEchoCancellation, noiseSuppression: p.settings.recordNoiseSuppression, autoGainControl: p.settings.recordAutoGain }))
      bars.current = []
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
  return { recording, midiRec, onMidiNote, live, stopRecord: () => (midiRec ? stopMidiRecord() : void stopRecord()), toggleRecord: () => void (recording ? stopRecord() : midiRec ? stopMidiRecord() : startRecord()) }
}
