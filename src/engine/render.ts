// 書き出し用の描画（全体、1 本のトラック、先に作って鳴らすためのかたまり）。再生と同じミキサーとグラフで作る
import { fxLists, instrumentIds } from './params'
import { Graph } from './graph'
import { prerollOf, subtree } from '../anticipate'
import { markActivity } from 'pevenmui/debug'
import { preloadInstruments } from 'wevocal-lib'
import { preloadFx, renderWithProgress, type Clip } from 'wevocal-lib'
import { loadMixer } from '../mixer/mixer'
import { preparePitch } from '../dsp/pitch'
import { ancestors, liveSlots, songEnd, type Project, midiBlocks } from '../project'
/**
 * オートメーションがあれば、つまみの値が変わる所（128 サンプルの倍数の時刻）でレンダリングを止めて、つまみを動かす。
 * 値の違う点の間は一定の間隔で、ほかは点の時刻だけ止める（最初の点より前、最後の点より後ろ、同じ値の点の間は値が変わらない）。
 * offset は、描画の 0 秒が曲の何秒か（先に作る音は途中から描くので、その時刻の値にする）
 */
export function scheduleAutomation(ctx: OfflineAudioContext, graph: Graph, p: Project, length: number, sampleRate: number, offset: number) {
  if (!graph.automated) return
  const step = 0.025
  const end = length / sampleRate
  const done = new Set<number>()
  const at = (sec: number) => {
    const q = Math.round((sec * sampleRate) / 128) * 128
    if (q <= 0 || q >= length || done.has(q)) return
    done.add(q)
    void ctx.suspend(q / sampleRate).then(() => {
      graph.automate(offset + q / sampleRate)
      void ctx.resume()
    })
  }
  for (const slot of [...(p.master.fx ?? []), ...p.tracks.flatMap((t) => liveSlots(t))]) {
    if (!slot.on || !slot.auto) continue
    for (const pts of Object.values(slot.auto)) {
      pts.forEach((b, i) => {
        at(b.t - offset)
        const a = pts[i - 1]
        if (!a || a.v === b.v) return
        // 値が変わる区間は、今までどおり一定の間隔で動かす
        for (let t = Math.max(a.t - offset, 0) + step; t < Math.min(b.t - offset, end); t += step) at(t)
      })
    }
  }
}

/** 全トラックをマスターまで混ぜた音（ステレオ）。書き出しの形式にするのは wevocal-lib の exportAudio */
/** until を渡すと、そこまでの長さにする（範囲選択が曲の終わりより後ろまであるとき） */
export async function renderMix(p: Project, until = 0, sampleRate = 48000, onProgress?: (p: number) => void, signal?: AbortSignal): Promise<Clip> {
  signal?.throwIfAborted()
  console.time('renderMix.pitch')
  await preparePitch(p, 0, true)
  console.timeEnd('renderMix.pitch')
  signal?.throwIfAborted()
  const length = Math.max(1, Math.ceil(Math.max(songEnd(p), until) * sampleRate))
  const ctx = new OfflineAudioContext(2, length, sampleRate)
  // 再生と同じミキサーで作る（再生と書き出しの音が一致する）。送ったものを受け取ってから始める
  await Promise.all([loadMixer(ctx), preloadFx(ctx, ...fxLists(p)), preloadInstruments(ctx, instrumentIds(p))])
  signal?.throwIfAborted()
  const graph = new Graph(ctx, 0)
  try {
    graph.sync(p, false)
    await graph.flush()
    signal?.throwIfAborted()
    scheduleAutomation(ctx, graph, p, length, sampleRate, 0)
    console.time('renderMix.offline')
    const out = await renderWithProgress(ctx, onProgress, signal)
    console.timeEnd('renderMix.offline')
    return { sampleRate, channels: [out.getChannelData(0), out.getChannelData(1)] }
  } finally {
    graph.dispose()
  }
}


/**
 * 1 本のトラックの、曲の時刻 start から dur 秒の音（ステレオ。音量、位相の反転、FX の列まで。パンとミュート、ソロは含めない）。
 * 先に作って鳴らす（anticipate.ts）ためのもの。状態を作るため、FX の余韻の長さ（prerollOf）だけ前から流して、その分は捨てる
 */
export async function renderTrackChunk(p: Project, trackId: string, start: number, dur: number, sampleRate: number): Promise<Float32Array[]> {
  const track = p.tracks.find((t) => t.id === trackId)
  if (!track) throw new Error('track not found')
  const t0 = Math.max(0, start - prerollOf(p, track))
  const lead = start - t0
  // 子孫のトラックも入れて、親の FX の列を通した音にする（子孫の音量、パン、ミュートは含める。ソロは見ない。memo/anticipate-parent.md）
  const kids = subtree(p, track).slice(1)
  const ids = new Set([trackId, ...kids.map((x) => x.id)])
  const q: Project = {
    ...p,
    master: { volume: 0, pan: 0, mute: false },
    tracks: [{ ...track, parent: undefined, pan: 0, mute: false, solo: false, sends: [], autoLane: undefined }, ...kids.map((x) => ({ ...x, solo: false, autoLane: undefined }))],
    blocks: p.blocks.filter((b) => ids.has(b.track)),
    midi: midiBlocks(p).filter((b) => ids.has(b.track)),
  }
  markActivity('anticipate: pitch')
  await preparePitch(q, 0, true)
  const length = Math.max(128, Math.ceil((lead + dur) * sampleRate))
  const ctx = new OfflineAudioContext(2, length, sampleRate)
  markActivity('anticipate: load fx')
  await Promise.all([loadMixer(ctx), preloadFx(ctx, ...fxLists(q)), preloadInstruments(ctx, instrumentIds(q))])
  const graph = new Graph(ctx, -t0)
  try {
    markActivity('anticipate: build graph')
    graph.sync(q, false)
    await graph.flush()
    scheduleAutomation(ctx, graph, q, length, sampleRate, t0)
    markActivity('anticipate: render')
    const out = await ctx.startRendering()
    markActivity('anticipate: copy')
    const from = Math.round(lead * sampleRate)
    return [out.getChannelData(0).slice(from), out.getChannelData(1).slice(from)]
  } finally {
    graph.dispose()
  }
}

/**
 * 1 本のトラックだけを混ぜた音（ステレオ。長さは `length` 秒）。.wvsp への書き出し用。
 * 波形ブロックの加工、トラックの FX の列、先祖のトラックのフェーダーと FX は音に含める。
 * 自分の音量、パン、位相の反転、ミュート、ソロは含めない（書き出し先のトラックの状態として渡す）
 */
export async function renderTrack(p: Project, trackId: string, length: number, sampleRate = 48000, signal?: AbortSignal): Promise<Clip> {
  const track = p.tracks.find((t) => t.id === trackId)
  if (!track) throw new Error('track not found')
  const chain = [...ancestors(p, track).reverse(), track]
  const tracks = chain.map((t) => (t === track ? { ...t, volume: 0, pan: 0, invert: false, mute: false, solo: false } : { ...t, mute: false, solo: false }))
  const q: Project = { ...p, master: { volume: 0, pan: 0, mute: false }, tracks, blocks: p.blocks.filter((b) => b.track === trackId), midi: midiBlocks(p).filter((b) => b.track === trackId) }
  return renderMix(q, length, sampleRate, undefined, signal)
}
