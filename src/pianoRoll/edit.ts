// ピアノロールの編集操作（移動、移調、長さ、クオンタイズ、コピーと貼り付け）。音符の並びを受けて、新しい並びを返す。画面を知らない
import { newId, type Note } from '../project'

const MIN_DUR = 1 / 64

/** ids の音符だけに fn をかける */
const only = (notes: Note[], ids: string[], fn: (n: Note) => Note) => notes.map((n) => (ids.includes(n.id) ? fn(n) : n))

/** 選んだ音符を、全部がブロックの中（0〜len 拍、0〜127）に収まる範囲で、拍と半音だけ動かす */
export function shift(notes: Note[], ids: string[], beats: number, semis: number, len: number): Note[] {
  const sel = notes.filter((n) => ids.includes(n.id))
  if (!sel.length) return notes
  const b = Math.max(Math.max(...sel.map((n) => -n.t)), Math.min(Math.min(...sel.map((n) => len - n.dur - n.t)), beats))
  const s = Math.max(Math.max(...sel.map((n) => -n.pitch)), Math.min(Math.min(...sel.map((n) => 127 - n.pitch)), semis))
  return only(notes, ids, (n) => ({ ...n, t: n.t + b, pitch: n.pitch + s }))
}

/** 選んだ音符の長さを、delta 拍だけ変える（最小は 1/64 拍、ブロックの終わりまで） */
export function resize(notes: Note[], ids: string[], delta: number, len: number): Note[] {
  return only(notes, ids, (n) => ({ ...n, dur: Math.max(MIN_DUR, Math.min(len - n.t, n.dur + delta)) }))
}

export interface QuantizeOptions {
  /** グリッドの間隔（拍） */
  step: number
  /** 始まりを寄せる */
  start: boolean
  /** 長さを寄せる（終わりをグリッドに合わせる） */
  length: boolean
  /** 寄せる強さ 0〜1（1 でグリッドの上に乗る） */
  strength: number
  /** スイング 0〜1（偶数番めのグリッドを後ろへずらす割合。0.5 で 3 連符の裏拍に近い） */
  swing: number
}

/** 選んだ音符を、グリッドに寄せる */
export function quantize(notes: Note[], ids: string[], o: QuantizeOptions, len: number): Note[] {
  return only(notes, ids, (n) => {
    let t = n.t
    let dur = n.dur
    if (o.start) {
      const k = Math.round(n.t / o.step)
      // 偶数番めのグリッド（裏）をずらす
      const target = (k + (k % 2 !== 0 ? o.swing * 0.5 : 0)) * o.step
      t = n.t + (target - n.t) * o.strength
    }
    if (o.length) {
      // 終わりは、始まりの次のグリッド以降
      const end = Math.max(t + o.step, Math.round((n.t + n.dur) / o.step) * o.step)
      dur = n.dur + (end - t - n.dur) * o.strength
    }
    t = Math.max(0, Math.min(len - MIN_DUR, t))
    return { ...n, t, dur: Math.max(MIN_DUR, Math.min(len - t, dur)) }
  })
}

/** 選んだ音符の終わりを、次の音符（同じ高さのもの）の頭まで伸ばす。最後の音符は変えない */
export function legato(notes: Note[], ids: string[]): Note[] {
  const sorted = [...notes].sort((a, b) => a.t - b.t)
  return only(notes, ids, (n) => {
    const next = sorted.find((q) => q.id !== n.id && q.pitch === n.pitch && q.t >= n.t + MIN_DUR)
    return next ? { ...n, dur: Math.max(MIN_DUR, next.t - n.t) } : n
  })
}

/** 選んだ音符の長さを、同じ値（拍）にする（ブロックの終わりまで） */
export function setDuration(notes: Note[], ids: string[], dur: number, len: number): Note[] {
  return only(notes, ids, (n) => ({ ...n, dur: Math.max(MIN_DUR, Math.min(len - n.t, dur)) }))
}

/** 音符を at 拍で 2 つに切る（後ろの音符は新しい id）。音符の中でなければ変えない */
export function slice(notes: Note[], id: string, at: number): Note[] {
  const n = notes.find((q) => q.id === id)
  if (!n || at <= n.t + MIN_DUR || at >= n.t + n.dur - MIN_DUR) return notes
  return notes.flatMap((q) => (q.id === id ? [{ ...q, dur: at - q.t }, { ...q, id: newId(), t: at, dur: q.t + q.dur - at }] : [q]))
}

/** 選んだ音符のうち、同じ高さで重なるか続いているものを 1 つにつなぐ（先頭の音符の強さを使う） */
export function glue(notes: Note[], ids: string[]): Note[] {
  const out: Note[] = []
  const sel = notes.filter((n) => ids.includes(n.id)).sort((a, b) => a.t - b.t)
  const drop = new Set<string>()
  for (const n of sel) {
    const head = out.find((q) => q.pitch === n.pitch && n.t <= q.t + q.dur + 1e-6)
    if (head) {
      head.dur = Math.max(head.dur, n.t + n.dur - head.t)
      drop.add(n.id)
    } else out.push({ ...n })
  }
  const merged = new Map(out.map((q) => [q.id, q]))
  return notes.filter((n) => !drop.has(n.id)).map((n) => merged.get(n.id) ?? n)
}

/** 選んだ音符のミュートを、value にする */
export const setMute = (notes: Note[], ids: string[], value: boolean): Note[] => only(notes, ids, (n) => ({ ...n, mute: value || undefined }))

/** 選んだ音符の強さを変える。mode: set は同じ値、add は足す、scale は掛ける */
export function velocity(notes: Note[], ids: string[], mode: 'set' | 'add' | 'scale', value: number): Note[] {
  const f = (v: number) => (mode === 'set' ? value : mode === 'add' ? v + value : v * value)
  return only(notes, ids, (n) => ({ ...n, vel: Math.max(0.02, Math.min(1, f(n.vel))) }))
}

/** コピーした音符（一番早い音符の頭を 0 とした拍） */
export interface NoteClip {
  notes: Omit<Note, 'id'>[]
  /** 全体の長さ（拍。一番早い頭から一番遅い終わりまで） */
  span: number
}

/** 選んだ音符を、コピーできる形にする。選んでいなければ null */
export function copyNotes(notes: Note[], ids: string[]): NoteClip | null {
  const sel = notes.filter((n) => ids.includes(n.id))
  if (!sel.length) return null
  const first = Math.min(...sel.map((n) => n.t))
  return { notes: sel.map(({ id: _, ...n }) => ({ ...n, t: n.t - first })), span: Math.max(...sel.map((n) => n.t + n.dur)) - first }
}

/** コピーした音符を at 拍に貼り付ける（ブロックからはみ出すものは入れない）。足した音符の id も返す */
export function pasteNotes(notes: Note[], clip: NoteClip, at: number, len: number): { notes: Note[]; added: string[] } {
  const added = clip.notes.flatMap((n) => (at + n.t < len ? [{ ...n, id: newId(), t: at + n.t, dur: Math.min(n.dur, len - at - n.t) }] : []))
  return { notes: [...notes, ...added], added: added.map((n) => n.id) }
}

/** 選んだ音符の終わり（拍）。選んでいなければ 0 */
export const selectionEnd = (notes: Note[], ids: string[]) => Math.max(0, ...notes.filter((n) => ids.includes(n.id)).map((n) => n.t + n.dur))

/** 選んだ音符の始まり（拍）と強さを、最大で time 拍、vel（0〜1）だけランダムにずらす */
export function humanize(notes: Note[], ids: string[], o: { time: number; vel: number }, len: number, rand: () => number = Math.random): Note[] {
  const jitter = (max: number) => (rand() * 2 - 1) * max
  return only(notes, ids, (n) => ({ ...n, t: Math.max(0, Math.min(len - n.dur, n.t + jitter(o.time))), vel: Math.max(0.02, Math.min(1, n.vel + jitter(o.vel))) }))
}
