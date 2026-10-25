// 先を走る Worker の中の、1 本のトラックの計算（声を足す → 音量 → processor の列）。128 サンプルずつ、曲の時刻で進める。Web Audio を知らない（memo/anticipate-stream.md）
import { autoValueAt, clampParam, ProcessorRunner, QUANTUM, SMOOTH, setFrame } from 'wevocal-lib/stream'
import type { ParamDef } from 'wevocal-lib'
import { mixInto, nextVoices, type ClipStore, type Live } from '../mixer/mixCore'
import type { Voice } from '../mixer/types'

/** processor の列の 1 項目（メインスレッドが FX の項目から作って送る） */
export interface StreamSlot {
  /** 読み込んだソースの見分け（同じなら processor を作り直さない） */
  key: string
  /** registerProcessor の名前 */
  name: string
  params: ParamDef[]
  values: Record<string, number>
  auto?: Record<string, { t: number; v: number }[]>
  on: boolean
  options: Record<string, unknown>
}

/** 1 つの項目の、動かしている processor と、つまみとオンオフの今の値（ならすため） */
interface Stage {
  slot: StreamSlot
  runner: ProcessorRunner
  /** つまみの今の値（ならした後） */
  cur: Map<string, number>
  /** 素通しとの混ぜ具合（1 でオン） */
  mix: number
  /** プラグインの状態（つまみ以外）の、知っている最後の値（同じなら渡さない） */
  state?: string
}

export class TrackStream {
  readonly sampleRate: number
  private live: Live[] = []
  private stages: Stage[] = []
  private gain = 1
  private gainCur: number | null = null
  /** ならしの 1 サンプルあたりの係数（setTargetAtTime と同じ形） */
  private readonly k: number
  private readonly L = new Float32Array(QUANTUM)
  private readonly R = new Float32Array(QUANTUM)
  private readonly ramp = new Float32Array(QUANTUM)

  private readonly clips: ClipStore
  /** プラグインが状態を保存したいとき（項目の番号、base64）。メインの FX の項目に入れてもらう */
  onState: ((index: number, state: string) => void) | null = null

  constructor(sampleRate: number, clips: ClipStore) {
    this.sampleRate = sampleRate
    this.clips = clips
    this.k = 1 - Math.exp(-1 / (SMOOTH * sampleRate))
  }

  /** 声を差し替える（時刻は曲の秒）。smooth なら、途中から始まる声をフェードインする */
  setVoices(voices: Voice[], now: number, smooth: boolean) {
    this.live = nextVoices(this.live, voices, now, smooth)
  }

  /** 音量（線形。位相の反転は負の値） */
  setGain(g: number) {
    this.gain = g
  }

  /** processor の列。同じ並び（key）の項目は processor を残し、値だけ変える */
  setSlots(slots: StreamSlot[]) {
    const same = slots.length === this.stages.length && slots.every((s, i) => s.key === this.stages[i].slot.key)
    if (same) {
      slots.forEach((s, i) => {
        const st = this.stages[i]
        st.slot = s
        // 元に戻すなどで状態が変わったら、プラグインに渡す（プラグインが知らせた値が戻ってきただけなら渡さない）
        const state = s.options.state as string | undefined
        if (state !== st.state) {
          st.state = state
          st.runner.port.postMessage({ __wevocalSetState: state })
        }
      })
      return
    }
    this.stages = slots.map((slot) => {
      const st: Stage = { slot, runner: new ProcessorRunner(slot.name, slot.options), cur: new Map(), mix: slot.on ? 1 : 0, state: slot.options.state as string | undefined }
      st.runner.port.onmessage = (e: MessageEvent<{ __wevocalState?: unknown }>) => {
        const state = e.data?.__wevocalState
        const index = this.stages.indexOf(st)
        if (typeof state !== 'string' || index < 0) return
        st.state = state
        this.onState?.(index, state)
      }
      return st
    })
  }

  /** 曲のサンプル位置 frame からの 128 サンプルを作る（out は左右。上書きする） */
  render(frame: number, outL: Float32Array, outR: Float32Array) {
    const t = frame / this.sampleRate
    const L = this.L
    const R = this.R
    L.fill(0)
    R.fill(0)
    mixInto(this.live, this.clips, t, this.sampleRate, L, R, 0)
    // 音量（変わったら、ならす）
    let g = this.gainCur ?? this.gain
    for (let i = 0; i < QUANTUM; i++) {
      g += (this.gain - g) * (this.gainCur === null ? 1 : this.k)
      L[i] *= g
      R[i] *= g
    }
    this.gainCur = g
    setFrame(frame)
    for (const st of this.stages) this.runStage(st, t, L, R)
    outL.set(L)
    outR.set(R)
  }

  /** 1 つの項目を通す。オフは素通し（切り替えは SMOOTH でならす）、下げ終わったら processor を止める */
  private runStage(st: Stage, t: number, L: Float32Array, R: Float32Array) {
    const target = st.slot.on ? 1 : 0
    if (target === 0 && st.mix < 1e-4) {
      st.mix = 0
      return
    }
    const ramps: Record<string, Float32Array> = {}
    for (const p of st.slot.params) {
      const want = clampParam(p, autoValueAt(st.slot.auto?.[p.id], t, st.slot.values[p.id] ?? p.default, !!p.choices))
      const was = st.cur.get(p.id)
      // 最初はならさずにそのまま。ほぼ同じなら一定の値で渡す
      if (was === undefined || p.choices || Math.abs(want - was) < 1e-6 * (Math.abs(want) + 1)) {
        st.cur.set(p.id, want)
        st.runner.set(p.id, want)
        continue
      }
      const r = new Float32Array(QUANTUM)
      let v = was
      for (let i = 0; i < QUANTUM; i++) r[i] = v += (want - v) * this.k
      st.cur.set(p.id, v)
      st.runner.set(p.id, v)
      ramps[p.id] = r
    }
    st.runner.process(L, R, ramps)
    let m = st.mix
    const ramp = this.ramp
    for (let i = 0; i < QUANTUM; i++) ramp[i] = m += (target - m) * this.k
    st.mix = m
    for (let i = 0; i < QUANTUM; i++) {
      L[i] = st.runner.outL[i] * ramp[i] + L[i] * (1 - ramp[i])
      R[i] = st.runner.outR[i] * ramp[i] + R[i] * (1 - ramp[i])
    }
  }
}
