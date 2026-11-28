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
