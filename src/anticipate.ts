// 先に計算して鳴らす（Anticipative FX processing）。重いプラグインを持つトラックの音を、再生位置より先に別のスレッド（OfflineAudioContext の描画）で作っておき、
// 音を出すスレッドは、できた音を読むだけにする。判断（どのトラックか、作り直しが要るか）だけをここに置く。描画と再生は engine.ts
import { findPlugin } from 'wevocal-lib'
import { bakedTracks, type Project, type Track } from './project'

/** 一度に作る長さ（秒）。再生位置からこの先まで作っておく */
export const CHUNK = 4
export const AHEAD = 12
/** 作り始める前に先に流して状態（リバーブの余韻など）を作る長さ（秒） */
export const PREROLL = 2

/** 外から足した、先に計算してよいプラグイン（processor 方式。anticipative が false のもの、サイドチェーンを使うものは除く）を持つか */
function heavy(t: Track): boolean {
  return !!t.fx?.some((s) => {
    const pl = findPlugin(s.plugin)
    return s.on && !!pl?.preload && pl.manifest.anticipative !== false && !s.sidechain
  })
}

/**
 * 先に計算して鳴らすトラックか。子のトラックの音が入るもの（その音は先に計算できない）、フリーズ中、
 * サイドチェーンで聞かれるだけなら問題ないが、自分が聞くもの（ほかのトラックの音が要る）は除く
 */
export function anticipated(p: Project, t: Track): boolean {
  return heavy(t) && !bakedTracks(p).has(t.id) && !p.tracks.some((x) => x.parent === t.id)
}

/** 前に作った識別（トラック、波形ブロックの並び、元の音の並び、テンポが同じなら同じ。どれも書き換えずに作り直すので、参照で比べられる） */
const sigCache = new WeakMap<Track, { blocks: Project['blocks']; sources: Project['sources']; bpm: number; sig: string }>()

/** そのトラックの音を決めるものの識別。変わったら、先に作った音は捨てる（音量、パン以外、FX、波形ブロック、元の音の長さ、テンポ） */
export function signature(p: Project, t: Track): string {
  const c = sigCache.get(t)
  if (c && c.blocks === p.blocks && c.sources === p.sources && c.bpm === p.tempo.bpm) return c.sig
  const sig = makeSignature(p, t)
  sigCache.set(t, { blocks: p.blocks, sources: p.sources, bpm: p.tempo.bpm, sig })
  return sig
}

function makeSignature(p: Project, t: Track): string {
  const blocks = p.blocks.filter((b) => b.track === t.id)
  const sources = [...new Set(blocks.map((b) => b.source))].map((id) => {
    const s = p.sources.find((x) => x.id === id)
    return `${id}:${s?.duration ?? 0}:${s?.clip.channels[0]?.length ?? 0}`
  })
  // 選択、レーンの表示、パンは音のこの段階に関係しない
  const { pan: _pan, autoLane: _lane, sends: _sends, name: _name, height: _height, collapsed: _collapsed, armed: _armed, mute: _mute, solo: _solo, ...rest } = t
  // プラグインが保存する状態（state）は、再生中に変わるので含めない
  const fx = rest.fx?.map(({ state: _state, ...s }) => s)
  return JSON.stringify([{ ...rest, fx }, blocks, sources, p.tempo.bpm])
}
