// 先に作った FX の音（anticipate.ts のかたまり）を、再生をまたいで取っておく。同じトラックの同じ音、同じ位置なら描かずに使う（memo/fx-cache.md）
import { CHUNK, PREROLL } from './anticipate'
import type { Project, Track } from './project'

/** 短い文字のハッシュ（プラグインが保存する状態は長いので、キーには縮めて入れる） */
function hash(s: string) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

/** トラックの設定（FX、音源、音量など。選択、レーンの表示、パン、プラグインが保存する状態は音に関係しない）の識別 */
const settingsCache = new WeakMap<Track, string>()
function settingsOf(t: Track) {
  let out = settingsCache.get(t)
  if (out === undefined) {
    const { pan: _pan, autoLane: _lane, sends: _sends, name: _name, height: _height, collapsed: _collapsed, armed: _armed, mute: _mute, solo: _solo, ...rest } = t
    out = hash(JSON.stringify({ ...rest, fx: rest.fx?.map(({ state: _state, ...s }) => s) }))
    settingsCache.set(t, out)
  }
  return out
}

/**
 * かたまりのキー。かたまり k の音は、k * CHUNK - PREROLL 秒から (k + 1) * CHUNK 秒までの波形ブロックと音符、トラックの設定、テンポで決まるので、
 * その範囲にかかるものだけをキーに入れる（別の所の編集では、このかたまりは作り直さない）。
 * プラグインが保存する状態は再生中に変わるので設定には入れず、取っておくときだけ入れる（プラグインの画面で音を変えたあとに、前の音を鳴らさないように）
 */
export function chunkKey(p: Project, trackId: string, k: number): string | null {
  const t = p.tracks.find((x) => x.id === trackId)
  if (!t) return null
  const from = k * CHUNK - PREROLL
  const to = (k + 1) * CHUNK
  const within = (b: { start: number; length: number }) => b.start < to && b.start + b.length > from
  const blocks = p.blocks.filter((b) => b.track === trackId && within(b))
  const midi = (p.midi ?? []).filter((b) => b.track === trackId && within(b))
  const sources = [...new Set(blocks.map((b) => b.source))].map((id) => {
    const s = p.sources.find((x) => x.id === id)
    return `${id}:${s?.duration ?? 0}:${s?.clip.channels[0]?.length ?? 0}`
  })
  const states = (t.fx ?? []).map((s) => (s.state ? hash(s.state) : '')).join(',')
  return `${trackId}|${settingsOf(t)}|${hash(JSON.stringify([blocks, midi, sources, p.tempo, p.markers]))}|${states}|${k}`
}

const bytesOf = (b: AudioBuffer) => b.length * b.numberOfChannels * 4

/** 使った順に並べ、上限を超えたら長く使っていないものから捨てる */
export class ChunkCache {
  private readonly map = new Map<string, AudioBuffer>()
  /** 作っている途中のもの（同じかたまりを二度描かない） */
  private readonly pending = new Map<string, Promise<AudioBuffer>>()
  private bytes = 0
  /** 上限（バイト）。0 なら取っておかない */
  limit = 256 * 1024 * 1024

  /** あればそれを、なければ make で作って入れる */
  async get(key: string | null, make: () => Promise<AudioBuffer>): Promise<AudioBuffer> {
    if (key === null || this.limit <= 0) return make()
    const hit = this.map.get(key)
    if (hit) {
      // 使った順の最後へ
      this.map.delete(key)
      this.map.set(key, hit)
      return hit
    }
    let job = this.pending.get(key)
    if (!job) {
      job = make()
      this.pending.set(key, job)
      job.then((b) => this.put(key, b)).catch(() => {}).finally(() => this.pending.delete(key))
    }
    return job
  }

  private put(key: string, b: AudioBuffer) {
    if (this.map.has(key)) return
    this.map.set(key, b)
    this.bytes += bytesOf(b)
    this.trim()
  }

  /** 上限まで、古いものから捨てる */
  trim() {
    for (const [key, b] of this.map) {
      if (this.bytes <= this.limit) break
      this.map.delete(key)
      this.bytes -= bytesOf(b)
    }
  }

  /** 全部捨てる */
  clear() {
    this.map.clear()
    this.bytes = 0
  }

  /** デバッグ表示（かたまりの数と大きさ） */
  describe() {
    return `${this.map.size} chunks ${Math.round(this.bytes / 1024 / 1024)}MB`
  }
}
