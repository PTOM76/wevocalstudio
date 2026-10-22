// MIDI 入力（キーボードなどの接続。ブラウザの Web MIDI。Chrome、Edge。Safari は非対応）。つないだ入力すべての、鳴らす、離すを onNote に渡す
import { useEffect, useRef } from 'react'

/** この環境で MIDI 入力を使えるか */
export const canMidiInput = () => typeof navigator !== 'undefined' && !!navigator.requestMIDIAccess

export function useMidiInput(o: { enabled: boolean; /** 使う機器の id（空はつないだすべて） */ device?: string; /** 受けるチャンネル（1〜16。0 はすべて） */ channel?: number; /** サステインペダル（CC64）で、離した音をペダルを上げるまで伸ばす */ sustain?: boolean; onNote: (pitch: number, vel: number, on: boolean) => void; fail: (e: unknown) => void }) {
  // 呼ぶ側の最新の関数を使う（つなぎ直さずに済むように）
  const latest = useRef(o)
  latest.current = o
  useEffect(() => {
    if (!o.enabled || !canMidiInput()) return
    let access: MIDIAccess | null = null
    let alive = true
    // サステイン: ペダルを踏んでいる間は、離した音を溜めておき、上げたときにまとめて離す
    let pedal = false
    const held = new Set<number>()
    const handler = (e: MIDIMessageEvent) => {
      const [status, a, b] = e.data ?? []
      if (status === undefined) return
      const { channel = 0, sustain = true, onNote } = latest.current
      if (channel > 0 && (status & 0x0f) !== channel - 1) return
      const cmd = status & 0xf0
      if (cmd === 0x90 && b > 0) {
        held.delete(a)
        onNote(a, b / 127, true)
      } else if (cmd === 0x80 || (cmd === 0x90 && b === 0)) {
        if (sustain && pedal) held.add(a)
        else onNote(a, 0, false)
      } else if (cmd === 0xb0 && a === 64 && sustain) {
        const down = b >= 64
        if (!down && pedal) for (const pitch of held) onNote(pitch, 0, false)
        if (!down) held.clear()
        pedal = down
      }
    }
    const attach = () => {
      const device = latest.current.device
      if (access) for (const input of access.inputs.values()) input.onmidimessage = !device || input.id === device ? handler : null
    }
    navigator
      .requestMIDIAccess()
      .then((a) => {
        if (!alive) return
        access = a
        attach()
        // 抜き差しされたら、つなぎ直す
        a.onstatechange = attach
      })
      .catch((e) => latest.current.fail(e))
    return () => {
      alive = false
      if (access) {
        access.onstatechange = null
        for (const input of access.inputs.values()) input.onmidimessage = null
      }
    }
  }, [o.enabled, o.device])
}
