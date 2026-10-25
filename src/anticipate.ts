// 先に計算して鳴らす（Anticipative FX processing）。重いプラグインを持つトラックの音を、再生位置より先に別のスレッド（OfflineAudioContext の描画）で作っておき、
// 音を出すスレッドは、できた音を読むだけにする。判断（どのトラックか、作り直しが要るか）だけをここに置く。描画と再生は engine.ts
import { findPlugin } from 'wevocal-lib'
import { ancestors, bakedTracks, descendants, SEND_MIN, type Project, type Track } from './project'

/** 一度に作る長さ（秒）。かたまりごとに PREROLL の分と FX の読み込みが余計にかかるので、短くしすぎない */
export const CHUNK = 8
/** 再生位置からこの先まで作っておく（秒） */
export const AHEAD = 16
/** 作り始める前に先に流して状態（リバーブの余韻など）を作る長さ（秒）。余韻のわからないプラグイン（VST など）に使う */
export const PREROLL = 2
/** 余韻のないプラグイン（EQ、コンプなど）でも、フィルターの直前の値やコンプのかかり具合を作るために流す長さ（秒） */
const PREROLL_MIN = 0.25
/** 助走の上限（秒）。これより長い余韻は、つなぎ目で少し欠ける */
const PREROLL_MAX = 6

/** かたまりの前に流す長さ（秒）。トラックと子孫の FX の余韻（manifest.tail、値で変わるものは値から）の最大。余韻を出さないプラグインがあれば PREROLL */
export function prerollOf(p: Project, t: Track): number {
  const tails = subtree(p, t).flatMap((x) =>
    (x.fx ?? [])
      .filter((s) => s.on)
      .map((s) => {
        const pl = findPlugin(s.plugin)
        if (pl?.tail) return pl.tail(s.values, p.tempo.bpm)
        return pl?.manifest.tail ?? PREROLL
      }),
  )
  return Math.min(PREROLL_MAX, Math.max(PREROLL_MIN, ...tails))
}

/** 外から足した、先に計算してよいプラグイン（processor 方式。anticipative が false のもの、サイドチェーンを使うものは除く）を持つか */
function heavy(t: Track): boolean {
  return !!t.fx?.some((s) => {
    const pl = findPlugin(s.plugin)
    return s.on && !!pl?.preload && pl.manifest.anticipative !== false && !s.sidechain
  })
}

/** トラックと子孫（親を先に計算するときは、子孫の音もまとめて作る。memo/anticipate-parent.md） */
export const subtree = (p: Project, t: Track): Track[] => [t, ...descendants(p, t)]

/**
 * 部分木（トラックと子孫）が外と音でつながっている理由。つながっていなければ null。
 * 子孫から外へ送るセンド、外から入るセンド（入った音が FX を通らずに鳴ってしまう）、サイドチェーンで外を聞く子孫の FX があると、部分木だけを先に作れない
 */
function linked(p: Project, t: Track): string | null {
  const ids = new Set(subtree(p, t).map((x) => x.id))
  const sends = (x: Track) => (x.sends ?? []).filter((s) => s.db > SEND_MIN)
  // 親自身のセンドは FX のあとの音から送るので、作った音でも送れる。子孫から外へのセンドは、作った音に入らないので外す
  if (descendants(p, t).some((x) => sends(x).some((s) => !ids.has(s.to)))) return 'sends out'
  if (p.tracks.some((x) => !ids.has(x.id) && sends(x).some((s) => ids.has(s.to)))) return 'sends in'
  if (descendants(p, t).some((x) => x.fx?.some((s) => s.on && s.sidechain))) return 'sidechain in child'
  return null
}

/**
 * 先に計算して鳴らすトラックか。フリーズ中、サイドチェーンで聞く FX、外と音でつながっている部分木は除く。
 * 子のトラックがあれば、子孫の音もまとめて作る。先祖が対象なら、その音に入っているので自分は対象にしない
 */
export function anticipated(p: Project, t: Track): boolean {
  return heavy(t) && !bakedTracks(p).has(t.id) && !linked(p, t) && !ancestors(p, t).some((a) => anticipated(p, a))
}

/** 外から足したプラグイン（processor 方式）がオンなのに、先に計算しない理由。対象のトラックか、そういうプラグインが無ければ null（デバッグ表示） */
export function excludedReason(p: Project, t: Track): string | null {
  if (!t.fx?.some((s) => s.on && !!findPlugin(s.plugin)?.preload)) return null
  if (!heavy(t)) return 'sidechain or not anticipative'
  if (bakedTracks(p).has(t.id)) return 'frozen'
  const link = linked(p, t)
  if (link) return link
  if (ancestors(p, t).some((a) => anticipated(p, a))) return 'in anticipated parent'
  return null
}

/** 前に作った識別（トラック、波形ブロックの並び、元の音の並び、テンポが同じなら同じ。どれも書き換えずに作り直すので、参照で比べられる） */
const sigCache = new WeakMap<Track, { tracks: Project['tracks']; blocks: Project['blocks']; sources: Project['sources']; bpm: number; sig: string }>()

/** そのトラックの音を決めるものの識別。変わったら、先に作った音は捨てる（音量、パン以外、FX、波形ブロック、元の音の長さ、テンポ） */
export function signature(p: Project, t: Track): string {
  const c = sigCache.get(t)
  if (c && c.tracks === p.tracks && c.blocks === p.blocks && c.sources === p.sources && c.bpm === p.tempo.bpm) return c.sig
  const sig = makeSignature(p, t)
  sigCache.set(t, { tracks: p.tracks, blocks: p.blocks, sources: p.sources, bpm: p.tempo.bpm, sig })
  return sig
}

function makeSignature(p: Project, t: Track): string {
  const ids = new Set(subtree(p, t).map((x) => x.id))
  const blocks = p.blocks.filter((b) => ids.has(b.track))
  const sources = [...new Set(blocks.map((b) => b.source))].map((id) => {
    const s = p.sources.find((x) => x.id === id)
    return `${id}:${s?.duration ?? 0}:${s?.clip.channels[0]?.length ?? 0}`
  })
  // 選択、レーンの表示、パンは音のこの段階に関係しない（子孫は、音量、パン、ミュートも親に入る音に効くので含める）
  const { pan: _pan, autoLane: _lane, sends: _sends, name: _name, height: _height, collapsed: _collapsed, armed: _armed, mute: _mute, solo: _solo, ...rest } = t
  // プラグインが保存する状態（state）は、再生中に変わるので含めない
  const fx = rest.fx?.map(({ state: _state, ...s }) => s)
  const kids = descendants(p, t).map(({ name: _n, height: _h, collapsed: _c, armed: _a, autoLane: _l, solo: _s, ...k }) => ({ ...k, fx: k.fx?.map(({ state: _st, ...x }) => x) }))
  return JSON.stringify([{ ...rest, fx }, kids, blocks, sources, p.tempo.bpm])
}
