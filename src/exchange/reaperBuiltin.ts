// Studio の組み込みの FX と REAPER の FX の対応（memo/daw-exchange.md）。A は REAPER 標準の JSFX（スライダーを単位のまま書く）、B は Rea 系の VST。
// どちらを先に使うかは設定（exchangeFxPrefer）。JSFX のスライダーの並びと範囲は、REAPER に付いてくる JSFX のソースの定義に合わせた
import type { FxSlot } from 'wevocal-lib'
import { EQ_ID, Q as EQ_Q, eqFreqs, valuesToEq } from 'wevocal-lib'
import { qToOctaves, type XFx } from './rppFx'

/** 変換先の優先。vst は B（Rea 系の VST）を先に、js は A（JSFX）を先に */
export type ReaperFxPrefer = 'vst' | 'js'

type Values = Record<string, number>
type JsFx = Extract<XFx, { kind: 'js' }>

const dB = (gain: number) => (gain <= 0 ? -120 : Math.max(-120, 20 * Math.log10(gain)))
const gain = (db: number) => (db <= -120 ? 0 : 10 ** (db / 20))
const clamp = (v: number, a: number, z: number) => Math.max(a, Math.min(z, v))
/** スライダーの並び（1 番から）。値の無い番号は undefined */
const sliders = (...v: (number | undefined)[]) => v

/** Studio の FX の id → JSFX（パスと、値からスライダーへ、スライダーから値へ） */
interface JsMap {
  path: string
  to: (v: Values, bpm: number) => (number | undefined)[]
  from: (s: number[]) => Values
}

/** ディレイの拍の同期（sync の選択肢）を ms にする */
const syncMs = (sync: number, bpm: number) => [0, 1, 0.5, 0.75, 0.25][Math.round(sync)] * (60000 / bpm)

const chorusJs: JsMap = {
  path: 'guitar/chorus',
  to: (v) => sliders(clamp(v.delay, 1, 250), clamp(Math.round((v.voices ?? 0) + 2), 1, 8), clamp(v.rate, 0.1, 16), clamp(v.depth, 0, 1), dB(v.mix), dB(1 - v.mix)),
  from: (s) => ({ delay: s[0], rate: s[2], depth: s[3], mix: gain(s[4]) / (gain(s[4]) + gain(s[5]) || 1) }),
}

const JS: Record<string, JsMap> = {
  'wevocal.delay': {
    path: 'delay/delay',
    // 時間、フィードバック（dB）、入力、ウェット、ドライ、長さを変えたときの再標本化（トーンは無い）
    to: (v, bpm) => sliders(clamp(Math.round(v.sync ? syncMs(v.sync, bpm) : v.time), 0, 4000), dB(v.feedback), 0, dB(v.mix), dB(1 - v.mix), 0),
    from: (s) => ({ sync: 0, time: clamp(s[0], 10, 2000), feedback: clamp(gain(s[1]), 0, 0.95), mix: clamp(gain(s[3]) / (gain(s[3]) + gain(s[4]) || 1), 0, 1) }),
  },
  'wevocal.chorus': chorusJs,
  'wevocal.ensemble': { ...chorusJs, from: (s) => ({ ...chorusJs.from(s), voices: clamp(Math.round(s[1]) - 2, 0, 6) }) },
  'wevocal.distortion': {
    path: 'guitar/distortion',
    // ゲイン、硬さ（soft 3、hard 10、fold 6）、最大の音量、ステレオ
    to: (v) => sliders(clamp(v.drive, 0, 50), [3, 10, 6][Math.round(v.shape)] ?? 3, clamp(v.level, -40, 0), 2),
    from: (s) => ({ drive: clamp(s[0], 0, 40), shape: s[1] >= 9 ? 1 : s[1] >= 5 ? 2 : 0, level: clamp(s[2], -24, 6) }),
  },
  'wevocal.limiter': {
    path: 'loser/MGA_JSLimiter',
    to: (v) => sliders(0, clamp(v.release, 0, 500), clamp(v.ceiling, -6, 0)),
    from: (s) => ({ release: clamp(s[1], 10, 1000), ceiling: clamp(s[2], -12, 0) }),
  },
  'wevocal.deesser': {
    path: 'Liteon/deesser',
    // ステレオ、ハイパスで検出、モニターなし、周波数、幅、しきい値、比率、時定数、ゲイン
    to: (v) => sliders(0, 1, 0, clamp(v.freq, 1500, 12000), 1.5, clamp(v.threshold, -80, 0), clamp(v.ratio, 1, 20), 0, 0),
    from: (s) => ({ freq: clamp(s[3], 2000, 12000), threshold: clamp(s[5], -60, 0), ratio: clamp(s[6], 1, 20) }),
  },
  'wevocal.filter': {
    path: 'sstillwell/hpflpf',
    // ハイパスとローパスだけ（バンドパスとノッチは変換しない: toJs で null）
    to: (v) => (Math.round(v.type) === 0 ? sliders(clamp(v.freq, 0, 1000), 22000, 0) : sliders(0, clamp(v.freq, 1000, 22000), 0)),
    from: (s) => (s[0] > 0 ? { type: 0, freq: s[0] } : { type: 1, freq: clamp(s[1], 20, 20000) }),
  },
  'wevocal.gate': {
    path: 'sstillwell/expander',
    // ゲートを比率 20 の下向きのエキスパンダーで代わりにする（しきい値、アタック、リリース）
    to: (v) => sliders(clamp(v.threshold, -120, 0), 20, 0, 0, 2, clamp(v.attack, 0, 200), clamp(v.release, 0, 100)),
    from: (s) => ({ threshold: clamp(s[0], -90, 0), attack: clamp(s[5], 0.1, 100), release: clamp(s[6], 5, 1000) }),
  },
  'wevocal.compressor': {
    path: 'sstillwell/majortom',
    // しきい値、比率、メイクアップ、ニー（0 dB なら硬い、それ以外は柔らかい）
    to: (v) => sliders(clamp(v.threshold, -60, 0), clamp(v.ratio, 1, 20), clamp(v.makeup, -20, 20), v.knee > 0 ? 3 : 2, 0, 0, 0, 0),
    from: (s) => ({ threshold: s[0], ratio: s[1], makeup: clamp(s[2], 0, 24), knee: s[3] === 3 || s[3] === 1 ? 6 : 0 }),
  },
  'wevocal.pitch': {
    path: 'pitch/superpitch',
    // セント、半音、オクターブ、窓、重なり、ウェット、ドライ、フィルター
    to: (v) => {
      const total = Math.round(v.pitch * 100)
      const oct = clamp(Math.trunc(total / 1200), -12, 12)
      const st = Math.trunc((total - oct * 1200) / 100)
      return sliders(total - oct * 1200 - st * 100, st, oct, 50, 20, 0, -120, 1)
    },
    from: (s) => ({ pitch: clamp(s[0] / 100 + s[1] + s[2] * 12, -24, 24) }),
  },
}

/** REAPER の JSFX のパス → Studio の FX の id（読み込み用。ensemble と chorus は声の数で分ける） */
const BY_PATH = new Map(Object.entries(JS).filter(([id]) => id !== 'wevocal.ensemble').map(([id, m]) => [m.path.toLowerCase(), id]))

/**
 * Rea 系の VST（つまみの値で状態を持つもの）。つまみの目盛りは、REAPER で TrackFX_SetParam と TrackFX_GetFormattedParamValue で測ったもの
 * （ReaComp は https://github.com/xDarkzx/Reaper-MCP/issues/41 の式とも一致）。.rpp に書くのは、REAPER が足す最後の 3 つ（バイパス、Wet、Delta）を除いたつまみ
 */
interface ReaMap {
  plugin: string
  name: string
  file: string
  /** 識別番号（4 文字） */
  uniqueId: number
  /** 入力のピンの数（サイドチェーンを持つものは 4） */
  inputs: number
  /** 新しく入れたときのつまみの値（REAPER で測った既定値） */
  defaults: number[]
  to: (v: Values, p: number[]) => void
  from: (p: number[]) => Values
}

const REA: ReaMap[] = [
  {
    // 0 しきい値（倍率）、1 比率（1 + 99 × 値）、2 アタック（500 ms × 値）、3 リリース（5000 ms × 値）、10 ドライ、11 ウェット（倍率）、14 ニー（24 dB × 値）
    plugin: 'wevocal.compressor',
    name: 'ReaComp (Cockos)',
    file: 'reacomp.dll',
    uniqueId: 0x7265636d,
    inputs: 4,
    defaults: [1, 0.030303, 0.006, 0.02, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.05, 0, 0, 0, 0.25, 0, 0, 0],
    to: (v, p) => {
      p[0] = gain(v.threshold)
      p[1] = clamp((v.ratio - 1) / 99, 0, 1)
      p[2] = clamp(v.attack / 500, 0, 1)
      p[3] = clamp(v.release / 5000, 0, 1)
      p[11] = gain(v.makeup)
      p[14] = clamp(v.knee / 24, 0, 1)
    },
    from: (p) => ({ threshold: clamp(dB(p[0]), -60, 0), ratio: clamp(1 + 99 * p[1], 1, 20), attack: clamp(p[2] * 500, 0, 100), release: clamp(p[3] * 5000, 10, 1000), makeup: clamp(dB(p[11]), 0, 24), knee: clamp(p[14] * 24, 0, 40) }),
  },
  {
    // 0 ウェット、1 ドライ（倍率）、2 部屋の大きさ（画面は 30 + 68 × 値）、3 ダンピング（100 % × 値）、4 幅（2 × 値 - 1）、5 プリディレイ（500 ms × 値）、6 ローパス、7 ハイパス（20000 Hz × 値）。部屋の種類は移らない
    plugin: 'wevocal.reverb',
    name: 'ReaVerbate (Cockos)',
    file: 'reaverbate.dll',
    uniqueId: 0x72766238,
    inputs: 2,
    defaults: [0.500035, 1, 0.294118, 0.5, 1, 0, 1, 0],
    to: (v, p) => {
      p[0] = clamp(v.mix, 0, 2)
      p[1] = clamp(1 - v.mix, 0, 2)
      p[2] = clamp(v.size, 0, 1)
      p[3] = clamp(v.damp, 0, 1)
      p[5] = clamp(v.predelay / 500, 0, 1)
    },
    from: (p) => ({ mix: clamp(p[0] / (p[0] + p[1] || 1), 0, 1), size: clamp(p[2], 0, 1), damp: clamp(p[3], 0, 1), predelay: clamp(p[5] * 500, 0, 100) }),
  },
  {
    // 0 しきい値（倍率）、1 アタック（500 ms × 値）、2 リリース（5000 ms × 値）、4 ホールド（1000 ms × 値）、9 ドライ（閉じても通る音。レンジにする）、10 ウェット（倍率）
    plugin: 'wevocal.gate',
    name: 'ReaGate (Cockos)',
    file: 'reagate.dll',
    uniqueId: 0x72656774,
    inputs: 4,
    defaults: [0, 0.006, 0.02, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0.543307, 0, 0, 0, 0],
    to: (v, p) => {
      p[0] = gain(v.threshold)
      p[1] = clamp(v.attack / 500, 0, 1)
      p[2] = clamp(v.release / 5000, 0, 1)
      p[4] = clamp(v.hold / 1000, 0, 1)
      p[9] = gain(v.range)
    },
    from: (p) => ({ threshold: clamp(dB(p[0]), -90, 0), attack: clamp(p[1] * 500, 0.1, 100), release: clamp(p[2] * 5000, 5, 1000), hold: clamp(p[4] * 1000, 0, 500), range: clamp(dB(p[9]), -90, 0) }),
  },
]

/**
 * 状態を塊で持つ Rea 系の VST。塊は REAPER が新しく入れたときのもの（16 進）を土台にし、つまみの所だけを書き換える。
 * 位置は、REAPER でつまみを 1 つずつ変えて塊を比べて調べた（データの先頭からのバイト）
 */
interface ReaChunkMap {
  plugin: string
  name: string
  file: string
  uniqueId: number
  template: string
  to: (v: Values, d: DataView) => void
  from: (d: DataView) => Values
}

const f32 = (d: DataView, at: number) => d.getFloat32(at, true)
const setF32 = (d: DataView, at: number, v: number) => d.setFloat32(at, v, true)

const REA_CHUNK: ReaChunkMap[] = [
  {
    // タップが 1 つ。24 ウェット、28 ドライ（倍率）、40 長さ（10000 ms × 値）、44 長さ（拍。使わないので 0）、48 フィードバック（倍率）、52 ローパス（20000 Hz × 値）
    plugin: 'wevocal.delay',
    name: 'ReaDelay (Cockos)',
    file: 'readelay.dll',
    uniqueId: 0x7265646c,
    template: '0000000000000000010000002c00000002000000000000004302003f0000803f000000000000803f000000000000003c9cd107330000803f000000000000803f0000803f0000803f0000003f',
    to: (v, d) => {
      setF32(d, 24, clamp(v.mix, 0, 2))
      setF32(d, 28, clamp(1 - v.mix, 0, 2))
      setF32(d, 40, clamp(v.time / 10000, 0, 1))
      setF32(d, 44, 0)
      setF32(d, 48, clamp(v.feedback, 0, 2))
      setF32(d, 52, clamp(v.tone / 20000, 0, 1))
    },
    from: (d) => ({ sync: 0, mix: clamp(f32(d, 24) / (f32(d, 24) + f32(d, 28) || 1), 0, 1), time: clamp(f32(d, 40) * 10000, 10, 2000), feedback: clamp(f32(d, 48), 0, 0.95), tone: clamp(f32(d, 52) * 20000, 1000, 20000) }),
  },
  {
    // 24 ウェット、28 ドライ（倍率）、40 ピッチ（全範囲。(値 - 0.5) × 48 半音）、56 フォルマント（同じ目盛り）
    plugin: 'wevocal.pitch',
    name: 'ReaPitch (Cockos)',
    file: 'reapitch.dll',
    uniqueId: 0x72657063,
    template: '00000000ffffffff010000002c00000002000000000000000000803f00000000000000000000803f0000003f0000003f0000003f0000003f0000003f0000003f0000003f0000803f0000003f',
    to: (v, d) => {
      setF32(d, 40, clamp(0.5 + v.pitch / 48, 0, 1))
      setF32(d, 56, clamp(0.5 + v.formant / 48, 0, 1))
    },
    from: (d) => ({ pitch: clamp((f32(d, 40) - 0.5) * 48, -24, 24), formant: clamp((f32(d, 56) - 0.5) * 48, -12, 12) }),
  },
  {
    // 8 しきい値、16 上限（dB の double）。リリース（40 の double）は単位が分からないので既定のまま
    plugin: 'wevocal.limiter',
    name: 'ReaLimit (Cockos)',
    file: 'realimit.dll',
    uniqueId: 0x726c6d74,
    template: '030000000000000000000000000000000000000000000000020000000002000000000000000000003f9f76e310c3c63f',
    to: (v, d) => d.setFloat64(16, clamp(v.ceiling, -24, 0), true),
    from: (d) => ({ ceiling: clamp(d.getFloat64(16, true), -12, 0) }),
  },
]

const fromHex = (h: string) => Uint8Array.from(h.match(/../g)!, (x) => parseInt(x, 16))

/** B（Rea 系の VST）にできる FX。WevEQ → ReaEQ、コンプ → ReaComp、リバーブ → ReaVerbate、ゲート → ReaGate、ディレイ → ReaDelay、ピッチ → ReaPitch、リミッター → ReaLimit */
function toVst(s: FxSlot, v: Values): XFx | null {
  const r = REA.find((x) => x.plugin === s.plugin)
  if (r) {
    const params = [...r.defaults]
    r.to(v, params)
    return { kind: 'vst', on: s.on, name: r.name, file: r.file, uniqueId: r.uniqueId, params, inputs: r.inputs, preset: '' }
  }
  const c = REA_CHUNK.find((x) => x.plugin === s.plugin)
  if (c) {
    const chunk = fromHex(c.template)
    c.to(v, new DataView(chunk.buffer))
    return { kind: 'vst', on: s.on, name: c.name, file: c.file, uniqueId: c.uniqueId, params: [], chunk, preset: '' }
  }
  if (s.plugin !== EQ_ID) return null
  const eq = valuesToEq(s.values, s.on)
  const bands = eqFreqs(eq.bands)
    .map((freq, i) => ({ freq, gain: eq.gains[i], bw: qToOctaves(EQ_Q[eq.bands]) }))
    .filter((b) => b.gain !== 0)
  return bands.length ? { kind: 'reaeq', on: s.on, bands } : null
}

/** A（JSFX）にする。変換先が無い、またはその設定を表せないものは null */
function toJs(s: FxSlot, values: Values, bpm: number): JsFx | null {
  const m = JS[s.plugin]
  if (!m) return null
  if (s.plugin === 'wevocal.filter' && Math.round(values.type) > 1) return null
  return { kind: 'js', on: s.on, path: m.path, sliders: m.to(values, bpm) }
}

/** 組み込みの FX を REAPER の FX にする（prefer の方を先に試す）。できなければ null */
export function builtinToReaper(s: FxSlot, values: Values, bpm: number, prefer: ReaperFxPrefer): XFx | null {
  return prefer === 'vst' ? (toVst(s, values) ?? toJs(s, values, bpm)) : (toJs(s, values, bpm) ?? toVst(s, values))
}

/** 読み込み: JSFX を Studio の FX にする。知らない JSFX は null */
export function jsToBuiltin(fx: JsFx): { plugin: string; values: Values } | null {
  const id = BY_PATH.get(fx.path.toLowerCase())
  if (!id) return null
  const s = fx.sliders.map((v) => v ?? 0)
  // 声が 3 つ以上なら ensemble、2 つまでなら chorus
  const plugin = id === 'wevocal.chorus' && s[1] > 2 ? 'wevocal.ensemble' : id
  return { plugin, values: JS[plugin].from(s) }
}

/** 読み込み: Rea 系の VST を Studio の FX にする（ReaComp、ReaVerbate、ReaGate、ReaDelay、ReaPitch、ReaLimit）。知らないものは null */
export function reaVstToBuiltin(fx: Extract<XFx, { kind: 'vst' }>): { plugin: string; values: Values } | null {
  const c = REA_CHUNK.find((x) => x.uniqueId === fx.uniqueId)
  if (c && fx.chunk && fx.chunk.length >= fromHex(c.template).length) return { plugin: c.plugin, values: c.from(new DataView(fx.chunk.buffer, fx.chunk.byteOffset, fx.chunk.byteLength)) }
  const r = REA.find((x) => x.uniqueId === fx.uniqueId)
  if (!r || fx.params.length < r.defaults.length) return null
  return { plugin: r.plugin, values: r.from(fx.params) }
}
