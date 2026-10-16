// MIDI 入力（キーボードなどの接続。ブラウザの Web MIDI。Chrome、Edge。Safari は非対応）。つないだ入力すべての、鳴らす、離すを onNote に渡す
import { useEffect, useRef } from 'react'

/** この環境で MIDI 入力を使えるか */
export const canMidiInput = () => typeof navigator !== 'undefined' && !!navigator.requestMIDIAccess

export function useMidiInput(o: { enabled: boolean; onNote: (pitch: number, vel: number, on: boolean) => void; fail: (e: unknown) => void }) {
  // 呼ぶ側の最新の関数を使う（つなぎ直さずに済むように）
  const latest = useRef(o)
  latest.current = o
  useEffect(() => {
    if (!o.enabled || !canMidiInput()) return
    let access: MIDIAccess | null = null
    let alive = true
    const handler = (e: MIDIMessageEvent) => {
      const [status, a, b] = e.data ?? []
      if (status === undefined) return
      const cmd = status & 0xf0
      if (cmd === 0x90 && b > 0) latest.current.onNote(a, b / 127, true)
      else if (cmd === 0x80 || (cmd === 0x90 && b === 0)) latest.current.onNote(a, 0, false)
    }
    const attach = () => {
      if (access) for (const input of access.inputs.values()) input.onmidimessage = handler
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
  }, [o.enabled])
}
