// 音のグラフと再生で共通に使う定数と補助の関数（つなぎの時間、遅れ、つまみへの書き込み、音量エンベロープの展開）
import { chainLatency } from 'wevocal-lib'
import { shapeProgress, ownAudible, ancestors, liveSlots, midiBlocks, type EnvPoint, type Project, type Track } from '../project'

/** 鳴らし直すとき、差し替えるときのつなぎ（秒） */
export const FADE = 0.02
/** 再生位置を続けて変えたときに、グラフを組み直す間隔の下限（秒） */
export const MIN_REBUILD = 0.12
/** 位置だけ動かすときの、送り直しの間隔の下限（秒） */
export const MIN_SEEK = 0.03
/** 鍵盤の音（ピアノロールの試聴など）を鳴らしておく長さの下限（秒）。押してすぐ離しても聞こえるように */
export const MONITOR_MIN = 0.15

/** 音源のプラグインの準備に使う、プロジェクトの音源の id */
export const instrumentIds = (p: Project) => p.tracks.flatMap((t) => (t.instrument ? [t.instrument.plugin] : []))

/** トラックの波形ブロックから出口までの遅れの最大（秒） */
export const trackLatency = (p: Project, t: Track, sampleRate: number) =>
  [t, ...ancestors(p, t)].reduce((sum, x) => sum + chainLatency(liveSlots(x), sampleRate), 0)
export const maxTrackLatency = (p: Project, sampleRate: number) => Math.max(0, ...p.tracks.map((t) => trackLatency(p, t, sampleRate)))

/** トラックの MIDI ブロックの識別（変わったら、送った音符を取り消して送り直す） */
export const midiSig = (p: Project, track: string) => {
  // もとの並びとテンポが同じなら前の結果を使う（同期のたびに全部の音符を文字にしない）
  const c = sigCache.get(track)
  if (c && c.tracks === p.tracks && c.tempo === p.tempo && c.markers === p.markers && c.midi === p.midi) return c.sig
  const t = p.tracks.find((x) => x.id === track)
  // 音符は拍なので、テンポが変わっても送り直す
  const sig = JSON.stringify([t && ownAudible(p, t), p.tempo, p.markers.filter((m) => m.tempo), midiBlocks(p).filter((b) => b.track === track)])
  sigCache.set(track, { tracks: p.tracks, tempo: p.tempo, markers: p.markers, midi: p.midi, sig })
  return sig
}
const sigCache = new Map<string, { tracks: Project['tracks']; tempo: Project['tempo']; markers: Project['markers']; midi: Project['midi']; sig: string }>()
/** 音量エンベロープの形状のある区間を、ミキサーに渡す折れ線の点に展開する（ミキサーは点の間を直線でつなぐ。段は、ごく短い傾きにする） */
export function volumeSteps(env: EnvPoint[]): EnvPoint[] {
  const out: EnvPoint[] = []
  env.forEach((a, i) => {
    out.push(a)
    const b = env[i + 1]
    if (!b || !a.shape || a.shape === 'linear') return
    if (a.shape === 'square') return void out.push({ t: Math.max(a.t, b.t - 0.001), db: a.db })
    for (let j = 1; j < 16; j++) out.push({ t: a.t + ((b.t - a.t) * j) / 16, db: a.db + (b.db - a.db) * shapeProgress(a.shape, j / 16, a.tension) })
  })
  return out
}

/** つまみに最後に入れた値 */
export const written = new WeakMap<AudioParam, number>()

/** つまみに値を入れる（at があれば、その時刻からならす）。同じ値なら書き込まない（同期のたびに予定が溜まって重くなるため） */
export function setParam(param: AudioParam, v: number, at: number | null) {
  if (written.get(param) === v) return
  written.set(param, v)
  if (at === null) param.value = v
  else param.setTargetAtTime(v, at, 0.01)
}

/** プロジェクトの FX の列（マスターとトラック）。導入したプラグインの準備に使う */
export const fxLists = (p: Project) => [p.master.fx, ...p.tracks.map((t) => t.fx)]

export const IOS = typeof navigator !== 'undefined' && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))
