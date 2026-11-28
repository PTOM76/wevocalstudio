// VST のプリセットのファイル（VST2 の .fxp、VST3 の .vstpreset）を作る。DAWproject の装置の状態に使う（形は VST SDK の仕様）
import type { XFx } from './rppFx'

type Vst = Extract<XFx, { kind: 'vst' }>

const ascii = (s: string, n: number) => Uint8Array.from({ length: n }, (_, i) => (i < s.length ? s.charCodeAt(i) & 0x7f : 0))

/** VST2 の .fxp。塊があれば FPCh、無ければつまみの値を並べた FxCk（数は big endian） */
export function fxp(f: Vst): Uint8Array {
  const body = f.chunk ? 4 + f.chunk.length : f.params.length * 4
  const out = new Uint8Array(56 + body)
  const v = new DataView(out.buffer)
  out.set(ascii('CcnK', 4), 0)
  v.setInt32(4, out.length - 8)
  out.set(ascii(f.chunk ? 'FPCh' : 'FxCk', 4), 8)
  v.setInt32(12, 1)
  v.setUint32(16, f.uniqueId >>> 0)
  v.setInt32(20, 1)
  // FPCh はプログラムの数、FxCk はつまみの数
  v.setInt32(24, f.chunk ? 1 : f.params.length)
  out.set(ascii(f.preset ?? 'Default', 27), 28)
  if (f.chunk) {
    v.setInt32(56, f.chunk.length)
    out.set(f.chunk, 60)
  } else f.params.forEach((x, i) => v.setFloat32(56 + i * 4, x))
  return out
}

/**
 * VST3 の .vstpreset。state は vstbridge の状態（4 バイトの長さと音の処理の状態、4 バイトの長さとコントローラーの状態）。
 * 見出し（'VST3'、版、cid の 32 文字、塊の一覧の位置）、状態、一覧（'Comp' と 'Cont' の位置と大きさ）の順（数は little endian）
 */
export function vstPreset(cid: string, state: Uint8Array): Uint8Array {
  const sv = new DataView(state.buffer, state.byteOffset, state.byteLength)
  const compLen = state.length >= 4 ? sv.getUint32(0, true) : 0
  const comp = state.subarray(4, 4 + compLen)
  const ctrlLen = state.length >= 8 + compLen ? sv.getUint32(4 + compLen, true) : 0
  const ctrl = state.subarray(8 + compLen, 8 + compLen + ctrlLen)
  const head = 48
  const parts = [{ id: 'Comp', data: comp }, ...(ctrl.length ? [{ id: 'Cont', data: ctrl }] : [])]
  const listAt = head + comp.length + ctrl.length
  const out = new Uint8Array(listAt + 8 + parts.length * 20)
  const v = new DataView(out.buffer)
  out.set(ascii('VST3', 4), 0)
  v.setInt32(4, 1, true)
  out.set(ascii(cid.toUpperCase(), 32), 8)
  v.setBigInt64(40, BigInt(listAt), true)
  let at = head
  const list: { id: string; at: number; size: number }[] = []
  for (const p of parts) {
    out.set(p.data, at)
    list.push({ id: p.id, at, size: p.data.length })
    at += p.data.length
  }
  out.set(ascii('List', 4), listAt)
  v.setInt32(listAt + 4, list.length, true)
  list.forEach((e, i) => {
    const o = listAt + 8 + i * 20
    out.set(ascii(e.id, 4), o)
    v.setBigInt64(o + 4, BigInt(e.at), true)
    v.setBigInt64(o + 12, BigInt(e.size), true)
  })
  return out
}

const text = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n))

/** .fxp を読む（FxCk はつまみの値、FPCh は塊）。形が違えば null */
export function readFxp(b: Uint8Array): { uniqueId: number; params?: number[]; chunk?: Uint8Array } | null {
  if (b.length < 56 || text(b, 0, 4) !== 'CcnK') return null
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const magic = text(b, 8, 4)
  const uniqueId = v.getUint32(16)
  if (magic === 'FxCk') {
    const n = v.getInt32(24)
    if (56 + n * 4 > b.length) return null
    return { uniqueId, params: Array.from({ length: n }, (_, i) => v.getFloat32(56 + i * 4)) }
  }
  if (magic === 'FPCh') {
    const n = v.getInt32(56)
    if (60 + n > b.length) return null
    return { uniqueId, chunk: b.slice(60, 60 + n) }
  }
  return null
}

/** .vstpreset を読み、cid と vstbridge の状態（長さ付きの Comp と Cont）にする。形が違えば null */
export function readVstPreset(b: Uint8Array): { cid: string; state: Uint8Array } | null {
  if (b.length < 48 || text(b, 0, 4) !== 'VST3') return null
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const cid = text(b, 8, 32).toUpperCase()
  const listAt = Number(v.getBigInt64(40, true))
  if (listAt + 8 > b.length || text(b, listAt, 4) !== 'List') return null
  const parts: Record<string, Uint8Array> = {}
  const n = v.getInt32(listAt + 4, true)
  for (let i = 0; i < n; i++) {
    const o = listAt + 8 + i * 20
    if (o + 20 > b.length) return null
    const at = Number(v.getBigInt64(o + 4, true))
    const size = Number(v.getBigInt64(o + 12, true))
    parts[text(b, o, 4)] = b.subarray(at, at + size)
  }
  const comp = parts.Comp ?? new Uint8Array()
  const ctrl = parts.Cont ?? new Uint8Array()
  const state = new Uint8Array(8 + comp.length + ctrl.length)
  const sv = new DataView(state.buffer)
  sv.setUint32(0, comp.length, true)
  state.set(comp, 4)
  sv.setUint32(4 + comp.length, ctrl.length, true)
  state.set(ctrl, 8 + comp.length)
  return { cid, state }
}
