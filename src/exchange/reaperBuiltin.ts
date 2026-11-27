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

/** B（Rea 系の VST）にできる FX。今は WevEQ → ReaEQ だけ（ほかの Rea 系はつまみの目盛りが分かってから足す） */
function toVst(s: FxSlot): XFx | null {
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
  return prefer === 'vst' ? (toVst(s) ?? toJs(s, values, bpm)) : (toJs(s, values, bpm) ?? toVst(s))
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
