// REAPER のプロジェクトに書く FX（<VST …> の項目と、状態の塊の base64）。組み込みの EQ は ReaEQ にする（memo/daw-exchange.md）
// 塊の形は REAPER が保存したファイルから読み取ったもの: 見出し（識別番号、印、入出力のピン、データの大きさ）、データ、プリセットの名前

/** 中間の形の FX。vst はつまみの値（0〜1）をそのまま、reaeq は帯（周波数、dB、幅（オクターブ））で持つ */
export type XFx =
  | { kind: 'vst'; on: boolean; name: string; file: string; uniqueId: number; params: number[] }
  | { kind: 'reaeq'; on: boolean; bands: { freq: number; gain: number; bw: number }[] }

/** ReaEQ の識別番号（'reeq'）と DLL の名前 */
const REAEQ_ID = 0x72656571
const REAEQ = { name: 'ReaEQ (Cockos)', file: 'reaeq.dll' }

class Bytes {
  private buf = new DataView(new ArrayBuffer(256))
  length = 0
  private room(n: number) {
    if (this.length + n <= this.buf.byteLength) return
    const next = new DataView(new ArrayBuffer(Math.max(this.buf.byteLength * 2, this.length + n)))
    new Uint8Array(next.buffer).set(new Uint8Array(this.buf.buffer, 0, this.length))
    this.buf = next
  }
  u8(v: number) {
    this.room(1)
    this.buf.setUint8(this.length, v)
    this.length += 1
    return this
  }
  u32(v: number) {
    this.room(4)
    this.buf.setUint32(this.length, v >>> 0, true)
    this.length += 4
    return this
  }
  u64(v: number) {
    return this.u32(v).u32(0)
  }
  f32(v: number) {
    this.room(4)
    this.buf.setFloat32(this.length, v, true)
    this.length += 4
    return this
  }
  f64(v: number) {
    this.room(8)
    this.buf.setFloat64(this.length, v, true)
    this.length += 8
    return this
  }
  bytes(b: Uint8Array) {
    this.room(b.length)
    new Uint8Array(this.buf.buffer).set(b, this.length)
    this.length += b.length
    return this
  }
  done() {
    return new Uint8Array(this.buf.buffer.slice(0, this.length))
  }
}

const base64 = (b: Uint8Array) => {
  let s = ''
  for (const x of b) s += String.fromCharCode(x)
  return btoa(s)
}

/** 塊を REAPER と同じ行に分ける（見出し 1 行、データは 96 バイトずつ、プリセットの名前 1 行） */
function blobLines(uniqueId: number, data: Uint8Array, chunk: boolean, preset: string): string[] {
  // 見出し: 識別番号、印（塊なら 0xfeed5eee、つまみの値なら 0xfeed5eef）、入力 2 つと出力 2 つ（左 1、右 2 のピン）、データの大きさ、塊かどうか、終わりの印
  const head = new Bytes().u32(uniqueId).u32(chunk ? 0xfeed5eee : 0xfeed5eef).u32(2).u64(1).u64(2).u32(2).u64(1).u64(2).u32(data.length).u32(chunk ? 1 : 0).u32(0x100000).done()
  const lines = [base64(head)]
  for (let i = 0; i < data.length; i += 96) lines.push(base64(data.subarray(i, i + 96)))
  const name = new TextEncoder().encode(preset)
  lines.push(base64(new Bytes().bytes(name).u8(0).bytes(name).u8(0).u32(0x10).done()))
  return lines
}

/** <VST の行の最後の 16 バイト（'VST' と識別番号の 4 文字と、名前の英数字の小文字 9 文字まで）を 16 進で */
function vstTag(uniqueId: number, name: string): string {
  const id = [uniqueId >>> 24, (uniqueId >>> 16) & 255, (uniqueId >>> 8) & 255, uniqueId & 255]
  // 「ReaEQ (Cockos)」の作り手の名前のように、かっこから後ろは使わない
  const letters = [...name.replace(/\s*\(.*$/, '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 9)].map((c) => c.charCodeAt(0))
  const b = [...'VST'].map((c) => c.charCodeAt(0)).concat(id, letters)
  while (b.length < 16) b.push(0)
  return b
    .slice(0, 16)
    .map((x) => x.toString(16).toUpperCase().padStart(2, '0'))
    .join('')
}

/** ReaEQ の塊（版 0x21、帯の数、帯ごとに種類（8 は帯域）、オン、周波数、倍率、幅（オクターブ）、印。最後に出力の倍率などの決まった値） */
function reaeqChunk(bands: { freq: number; gain: number; bw: number }[]): Uint8Array {
  const b = new Bytes().u32(0x21).u32(bands.length)
  for (const x of bands) b.u32(8).u32(1).f64(x.freq).f64(10 ** (x.gain / 20)).f64(x.bw).u8(1)
  return b.u32(1).u32(1).f64(1).u32(0).u32(509).u32(294).u32(2).done()
}

/** 1 つの FX の行（BYPASS、<VST …> と塊、> まで）。quote は RPP の文字列の囲み */
export function fxLines(fx: XFx, quote: (s: string) => string): string[] {
  const vst = fx.kind === 'vst' ? fx : { name: REAEQ.name, file: REAEQ.file, uniqueId: REAEQ_ID }
  const data = fx.kind === 'vst' ? fx.params.reduce((b, v) => b.f32(v), new Bytes().u32(0xdeadbeef).u32(0xdeadf00d)).done() : reaeqChunk(fx.bands)
  const lines = blobLines(vst.uniqueId, data, fx.kind === 'reaeq', fx.kind === 'vst' ? 'Default' : '')
  return [`BYPASS ${fx.on ? 0 : 1} 0 0`, `<VST ${quote(`VST: ${vst.name}`)} ${quote(vst.file)} 0 "" ${vst.uniqueId >>> 0}<${vstTag(vst.uniqueId, vst.name)}> ""`, ...lines.map((l) => `  ${l}`), '>', 'FLOATPOS 0 0 0 0', 'WAK 0 0']
}

const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

/**
 * <VST …> の項目を読む（fxLines の逆）。ReaEQ は帯域（種類 8）の帯だけを、つまみの値の VST はその値を読む。
 * 塊でしか状態を持たない VST（つまみの値が読めない）と、読めない塊は null
 */
export function readFx(o: { name: string; file: string; uniqueId: number; lines: string[]; on: boolean }): XFx | null {
  let raw: Uint8Array[]
  try {
    raw = o.lines.map(fromBase64)
  } catch {
    return null
  }
  if (raw.length < 2) return null
  const head = new DataView(raw[0].buffer)
  // 見出し: 識別番号、印、入力の数とピン（8 バイトずつ）、出力の数とピン、データの大きさ、塊かどうか
  let at = 8
  const ins = head.getUint32(at, true)
  at += 4 + ins * 8
  const outs = at + 4 <= head.byteLength ? head.getUint32(at, true) : 0
  at += 4 + outs * 8
  if (at + 8 > head.byteLength) return null
  const size = head.getUint32(at, true)
  const chunk = head.getUint32(at + 4, true) === 1
  const all = new Uint8Array(raw.slice(1).reduce((n, r) => n + r.length, 0))
  raw.slice(1).reduce((n, r) => (all.set(r, n), n + r.length), 0)
  const data = new DataView(all.buffer, 0, Math.min(size, all.length))
  if (o.uniqueId === REAEQ_ID && chunk) {
    const n = data.byteLength >= 8 ? data.getUint32(4, true) : 0
    const bands: { freq: number; gain: number; bw: number }[] = []
    for (let i = 0, p = 8; i < n && p + 33 <= data.byteLength; i++, p += 33) {
      const type = data.getUint32(p, true)
      const enabled = data.getUint32(p + 4, true) === 1
      const gain = data.getFloat64(p + 16, true)
      if (type === 8 && enabled && gain > 0) bands.push({ freq: data.getFloat64(p + 8, true), gain: 20 * Math.log10(gain), bw: data.getFloat64(p + 24, true) })
    }
    return { kind: 'reaeq', on: o.on, bands }
  }
  if (chunk || data.byteLength < 8 || data.getUint32(0, true) !== 0xdeadbeef) return null
  const params = Array.from({ length: (data.byteLength - 8) >> 2 }, (_, i) => data.getFloat32(8 + i * 4, true))
  return { kind: 'vst', on: o.on, name: o.name.replace(/^VST3?i?: /, '').replace(/\s*\([^()]*\)$/, ''), file: o.file, uniqueId: o.uniqueId, params }
}

/** Q（Web Audio の peaking）を ReaEQ の幅（オクターブ）にする */
export const qToOctaves = (q: number) => ((2 / Math.LN2) * Math.asinh(1 / (2 * q)))
