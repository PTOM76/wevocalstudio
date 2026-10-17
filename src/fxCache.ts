// 先に作った FX の音（anticipate.ts のかたまり）を、再生をまたいで取っておく。同じトラックの同じ音、同じ位置なら描かずに使う（memo/fx-cache.md）
import { signature } from './anticipate'
import type { Project } from './project'

/** 短い文字のハッシュ（プラグインが保存する状態は長いので、キーには縮めて入れる） */
function hash(s: string) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

/**
 * かたまりのキー。signature は再生中に変わるプラグインの状態を含めないので、取っておくときは状態も入れる
 * （プラグインの画面で音を変えたあとに、前の音を鳴らさないように）
 */
export function chunkKey(p: Project, trackId: string, k: number): string | null {
  const t = p.tracks.find((x) => x.id === trackId)
  if (!t) return null
  const states = (t.fx ?? []).map((s) => (s.state ? hash(s.state) : '')).join(',')
  return `${trackId}|${hash(signature(p, t))}|${states}|${k}`
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
