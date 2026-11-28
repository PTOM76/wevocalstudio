// REAPER のプロジェクトに書く FX（<VST …> の項目と、状態の塊の base64）。組み込みの EQ は ReaEQ にする（memo/daw-exchange.md）
// 塊の形は REAPER が保存したファイルから読み取ったもの: 見出し（識別番号、印、入出力のピン、データの大きさ）、データ、プリセットの名前

/** 中間の形の FX。vst はつまみの値（0〜1）をそのまま、reaeq は帯（周波数、dB、幅（オクターブ））で持つ */
export type XFx =
  | { kind: 'vst'; on: boolean; name: string; file: string; uniqueId: number; params: number[]; /** 状態の塊（塊でしか状態を持たない VST）。あれば params より優先して書く */ chunk?: Uint8Array; /** 入力のピンの数（サイドチェーンを持つ ReaComp は 4。省くと 2） */ inputs?: number; /** プリセットの名前（省くと Default） */ preset?: string; /** VST3 のクラスの id（32 桁の 16 進。DAWproject のみ書く） */ cid?: string; /** Studio のプラグインの id（書き出す前に状態を作るため） */ plugin?: string; /** DAWproject の状態のファイル（zip の中のパス。読み込みで中身を読んで chunk か params にする） */ statePath?: string }
  | { kind: 'reaeq'; on: boolean; bands: { freq: number; gain: number; bw: number }[] }
  /** REAPER の JSFX（パスと、スライダーの値を単位のまま。1 番から並べ、無い番号は undefined） */
  | { kind: 'js'; on: boolean; path: string; sliders: (number | undefined)[] }

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
function blobLines(uniqueId: number, data: Uint8Array, chunk: boolean, preset: string, inputs = 2): string[] {
  // 見出し: 識別番号、印（塊なら 0xfeed5eee、つまみの値なら 0xfeed5eef）、入力 2 つと出力 2 つ（左 1、右 2 のピン）、データの大きさ、塊かどうか、終わりの印
  // 入力のピンは 1、2、4、8…（3 つ目からはサイドチェーン）
  const head = new Bytes().u32(uniqueId).u32(chunk ? 0xfeed5eee : 0xfeed5eef).u32(inputs)
  for (let i = 0; i < inputs; i++) head.u64(2 ** i)
  head.u32(2).u64(1).u64(2).u32(data.length).u32(chunk ? 1 : 0).u32(0x100000)
  const lines = [base64(head.done())]
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
  // JSFX: <JS パス ""> のあとに、64 個のスライダーの値を 1 行に（無い番号は -）
  if (fx.kind === 'js') {
    const values = Array.from({ length: 64 }, (_, i) => (fx.sliders[i] === undefined ? '-' : String(Math.round(fx.sliders[i]! * 1e6) / 1e6)))
    return [`BYPASS ${fx.on ? 0 : 1} 0 0`, `<JS ${fx.path.includes(' ') ? quote(fx.path) : fx.path} ""`, `  ${values.join(' ')}`, '>', 'FLOATPOS 0 0 0 0', 'WAK 0 0']
  }
  const vst = fx.kind === 'vst' ? fx : { name: REAEQ.name, file: REAEQ.file, uniqueId: REAEQ_ID }
  const vst3 = fx.kind === 'vst' && fx.cid && fx.chunk ? fx.cid : null
  const chunk = fx.kind === 'reaeq' || !!fx.chunk
  const data = fx.kind === 'reaeq' ? reaeqChunk(fx.bands) : vst3 && fx.chunk ? toReaperVst3(fx.chunk) : fx.chunk ?? fx.params.reduce((b, v) => b.f32(v), new Bytes().u32(0xdeadbeef).u32(0xdeadf00d)).done()
  const lines = blobLines(vst.uniqueId, data, chunk, fx.kind === 'vst' ? (fx.preset ?? 'Default') : '', fx.kind === 'vst' ? fx.inputs : 2)
  // VST3 は「VST3: 名前」と、番号の後ろに {クラスの id}
  const tag = vst3 ? `{${vst3.toUpperCase()}}` : `<${vstTag(vst.uniqueId, vst.name)}>`
  return [`BYPASS ${fx.on ? 0 : 1} 0 0`, `<VST ${quote(`${vst3 ? 'VST3' : 'VST'}: ${vst.name}`)} ${vst.file.includes(' ') ? quote(vst.file) : vst.file} 0 "" ${vst.uniqueId >>> 0}${tag} ""`, ...lines.map((l) => `  ${l}`), '>', 'FLOATPOS 0 0 0 0', 'WAK 0 0']
}

/**
 * VST3 の状態（vstbridge の形: 長さと音の処理の状態、長さとコントローラーの状態）を、REAPER の塊のデータにする。
 * REAPER が保存したファイルから読み取った形: 音の処理の状態の長さ、1、音の処理の状態、コントローラーの状態の長さ、コントローラーの状態、0
 */
export function toReaperVst3(state: Uint8Array): Uint8Array {
  const { comp, ctrl } = splitVst3(state)
  return new Bytes().u32(comp.length).u32(1).bytes(comp).u32(ctrl.length).bytes(ctrl).u32(0).done()
}

/** REAPER の VST3 の塊のデータを、vstbridge の状態の形にする（toReaperVst3 の逆）。形が違えば null */
export function fromReaperVst3(d: Uint8Array): Uint8Array | null {
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength)
  if (d.length < 12) return null
  const n = v.getUint32(0, true)
  if (8 + n + 4 > d.length) return null
  const comp = d.subarray(8, 8 + n)
  const m = v.getUint32(8 + n, true)
  const ctrl = 12 + n + m <= d.length ? d.subarray(12 + n, 12 + n + m) : new Uint8Array()
  return new Bytes().u32(comp.length).bytes(comp).u32(ctrl.length).bytes(ctrl).done()
}

/** vstbridge の状態を、音の処理の状態とコントローラーの状態に分ける */
function splitVst3(state: Uint8Array): { comp: Uint8Array; ctrl: Uint8Array } {
  const v = new DataView(state.buffer, state.byteOffset, state.byteLength)
  const n = state.length >= 4 ? v.getUint32(0, true) : 0
  const comp = state.subarray(4, 4 + n)
  const m = state.length >= 8 + n ? v.getUint32(4 + n, true) : 0
  return { comp, ctrl: state.subarray(8 + n, 8 + n + m) }
}

const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

/**
 * <VST …> の項目を読む（fxLines の逆）。ReaEQ は帯域（種類 8）の帯だけを、つまみの値の VST はその値を読む。
 * 塊でしか状態を持たない VST（つまみの値が読めない）と、読めない塊は null
 */
export function readFx(o: { name: string; file: string; uniqueId: number; lines: string[]; on: boolean; cid?: string }): XFx | null {
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
  const name = o.name.replace(/^VST3?i?: /, '').replace(/\s*\([^()]*\)$/, '')
  // VST3 は塊を vstbridge の状態の形にする
  if (o.cid) {
    const state = chunk ? fromReaperVst3(all.subarray(0, data.byteLength)) : null
    return state ? { kind: 'vst', on: o.on, name, file: o.file, uniqueId: o.uniqueId, params: [], cid: o.cid, chunk: state } : null
  }
  // 塊でしか状態を持たない VST は、塊をそのまま持つ（つまみの値は読み込むときに VST から読む）
  if (chunk) return data.byteLength ? { kind: 'vst', on: o.on, name, file: o.file, uniqueId: o.uniqueId, params: [], chunk: new Uint8Array(all.subarray(0, data.byteLength)) } : null
  if (data.byteLength < 8 || data.getUint32(0, true) !== 0xdeadbeef) return null
  const params = Array.from({ length: (data.byteLength - 8) >> 2 }, (_, i) => data.getFloat32(8 + i * 4, true))
  return { kind: 'vst', on: o.on, name, file: o.file, uniqueId: o.uniqueId, params }
}

/** Q（Web Audio の peaking）を ReaEQ の幅（オクターブ）にする */
export const qToOctaves = (q: number) => ((2 / Math.LN2) * Math.asinh(1 / (2 * q)))
