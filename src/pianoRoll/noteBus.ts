// MIDI キーボードの弾いた音を、開いているピアノロールに渡す（ステップ入力で使う）。App が弾いた音を流し、ピアノロールが受ける
type Listener = (pitch: number, vel: number, on: boolean) => void

const listeners = new Set<Listener>()

/** 弾いた音（高さ、強さ、鳴らすか離すか）を、受けている所に渡す */
export const emitNote: Listener = (pitch, vel, on) => listeners.forEach((fn) => fn(pitch, vel, on))

/** 弾いた音を受ける。戻り値で受けるのをやめる */
export function subscribeNote(fn: Listener) {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}
