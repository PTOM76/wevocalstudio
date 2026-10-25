// ミキサーの計算（声を 128 サンプルずつ足す）。音を出すスレッドのミキサー（mixer.worklet.ts）と、先を走る Worker で共通に使う。画面と Web Audio を知らない
import type { Voice } from './types'

/** 消えた声、止めたときに 0 まで下げる長さ（秒） */
export const FADE = 0.02

/** 鳴らしている声と、足されたとき（途中から足されたらフェードイン）、消されたとき（フェードアウト） */
export interface Live {
  v: Voice
  bornAt: number
  diedAt: number
  /** 音量のエンベロープで前に見つけた点の位置（時刻は進むので、次はここから探す） */
  ei?: number
}

/** 時刻 t の声の音量（線形） */
export function gainAt(l: Live, t: number): number {
  const v = l.v
  let g = v.level
  // 波形ブロックのフェード
  if (v.fadeIn > 0 && t < v.bt0 + v.fadeIn) g *= Math.max(0, (t - v.bt0) / v.fadeIn)
  if (v.fadeOut > 0 && t > v.bt1 - v.fadeOut) g *= Math.max(0, (v.bt1 - t) / v.fadeOut)
  // 片のつなぎ目（隣の片と XFADE ずつ重ねる）
  if (v.joinIn > 0 && t < v.t0 + v.joinIn) g *= Math.max(0, (t - v.t0) / v.joinIn)
  if (v.joinOut > 0 && t > v.t1 - v.joinOut) g *= Math.max(0, (v.t1 - t) / v.joinOut)
  // 音量のエンベロープ（点の間は線形。外は端の点の値）
  const e = v.env
  if (e.length) {
    if (t <= e[0]) g *= e[1]
    else if (t >= e[e.length - 2]) g *= e[e.length - 1]
    else {
      // 前に見つけた点から探す（戻っていれば頭から）
      let i = l.ei !== undefined && l.ei < e.length && t > e[l.ei - 2] ? l.ei : 2
      while (i < e.length && t > e[i]) i += 2
      l.ei = i
      const t0 = e[i - 2]
      g *= t0 === e[i] ? e[i + 1] : e[i - 1] + ((e[i + 1] - e[i - 1]) * (t - t0)) / (e[i] - t0)
    }
  }
  // 途中から足された、消された
  if (l.bornAt > 0) g *= Math.min(1, Math.max(0, (t - l.bornAt) / FADE))
  if (l.diedAt > 0) g *= Math.max(0, 1 - (t - l.diedAt) / FADE)
  return g
}

/** 音のデータ（id → サンプルレートと左右） */
export type ClipStore = Map<number, { sampleRate: number; channels: Float32Array[] }>

/**
 * 時刻 t0（秒）からの L.length サンプルに、live の声を足す。live は始まりの順で、終わった声はその場で詰めて捨てる（配列を作らない）。
 * stoppedAt が 0 より大きければ、そこから FADE で下げる
 */
export function mixInto(live: Live[], clips: ClipStore, t0: number, sampleRate: number, L: Float32Array, R: Float32Array, stoppedAt: number) {
  const n = L.length
  const t1 = t0 + n / sampleRate
  const stopping = stoppedAt > 0
    // 終わった声をその場で詰めて捨てる（process の中では配列を作らない）
    let w = 0
    for (let r = 0; r < live.length; r++) {
      const l = live[r]
      if (l.v.t1 <= t0 || (l.diedAt > 0 && t0 > l.diedAt + FADE)) continue
      live[w++] = l
    }
    live.length = w
    for (const l of live) {
      const v = l.v
      if (v.t0 >= t1) break
      const clip = clips.get(v.clip)
      if (!clip) continue
      // 音量は 128 サンプルの頭と終わりで求めて、その間は直線で結ぶ（フェードは 5 ms 以上なので十分）
      let ga = gainAt(l, t0)
      let gb = gainAt(l, t1)
      if (stopping) {
        ga *= Math.max(0, 1 - (t0 - stoppedAt) / FADE)
        gb *= Math.max(0, 1 - (t1 - stoppedAt) / FADE)
      }
      if (ga === 0 && gb === 0) continue
      const cl = clip.channels[0]
      const cr = clip.channels[1] ?? cl
      const len = cl.length
      // 元の音の位置（ctx と元の音のサンプルレートが違えば、その比で進める）
      const step = clip.sampleRate / sampleRate
      const startPos = v.f0 + (t0 - v.t0) * clip.sampleRate
      // 128 サンプルのうち声にかかる所だけを回す
      const i0 = Math.max(0, Math.ceil((v.t0 - t0) * sampleRate))
      const i1 = Math.min(n, Math.ceil((v.t1 - t0) * sampleRate))
      // 音量の 1 サンプルあたりの変化（割り算をループの外に出す）。モノラルの音は 1 回だけ補間して左右に足す
      const dg = (gb - ga) / n
      const mono = cr === cl
      for (let i = i0; i < i1; i++) {
        const pos = startPos + i * step
        const k = Math.floor(pos)
        if (k < 0 || k + 1 >= len) continue
        const f = pos - k
        const g = ga + dg * i
        const left = (cl[k] + (cl[k + 1] - cl[k]) * f) * g
        L[i] += left
        R[i] += mono ? left : (cr[k] + (cr[k + 1] - cr[k]) * f) * g
      }
    }
}

/**
 * 新しい声の一覧に差し替えた live（時刻 now）。変わっていない声はそのまま、新しい声は途中から始まるなら（smooth のとき）フェードインし、
 * 変わった声と消えた声はフェードアウトしてから捨てる。live の配列にも、変わった声の消える分を足す（そのあと拾うため）
 */
export function nextVoices(live: Live[], voices: Voice[], now: number, smooth: boolean): Live[] {
  const keep = new Map(live.filter((l) => l.diedAt === 0).map((l) => [l.v.key, l]))
  const next: Live[] = []
  for (const v of voices) {
    const old = keep.get(v.key)
    keep.delete(v.key)
    // 変わっていない声はそのまま。新しい声は、途中から始まるなら（差し替え）フェードインする
    next.push(old && old.v.sig === v.sig ? old : { v, bornAt: smooth && v.t0 < now ? now : 0, diedAt: 0 })
    if (old && old.v.sig !== v.sig) live.push({ ...old, diedAt: now })
  }
  // 消えた声と、消している途中の声はフェードアウトしてから捨てる
  for (const l of keep.values()) next.push({ ...l, diedAt: now })
  for (const l of live) if (l.diedAt > 0 && now < l.diedAt + FADE) next.push(l)
  next.sort((a, b) => a.v.t0 - b.v.t0)
  return next
}
