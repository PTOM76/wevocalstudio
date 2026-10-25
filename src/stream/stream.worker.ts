// 先を走る Worker。トラックごとに TrackStream を持ち、再生位置の AHEAD 先まで作り続けて、読むだけのノード（stream.reader.worklet.ts）へ送る（memo/anticipate-stream.md）
import { installScope, loadProcessorSource, QUANTUM } from 'wevocal-lib/stream'
import type { ClipStore } from '../mixer/mixCore'
import { TrackStream } from './trackStream'
import type { ReaderMessage, StreamMessage } from './types'

/** 再生位置からこの先まで作っておく（秒） */
const AHEAD = 0.4
/** 編集したあと、作り直し始める位置の、再生位置からの余裕（秒。読む側に届くまでの分） */
const SAFE = 0.08
/** 1 回に送る長さ（サンプル。QUANTUM の倍数） */
const BLOCK = QUANTUM * 8

const scope = self as unknown as { postMessage(m: unknown): void; onmessage: ((e: MessageEvent<StreamMessage>) => void) | null }

let sampleRate = 48000
const clips: ClipStore = new Map()
const loaded = new Set<string>()
interface Track {
  stream: TrackStream
  port: MessagePort
  /** 次に作る位置（曲のサンプル） */
  write: number
  /** ここより前は助走（作るが送らない）。再生を始めた位置 */
  discard: number
  /** 始める前に流す長さ（秒。FX の余韻の長さ） */
  preroll: number
  /** 再生を始めてから、最初の分を送ったか */
  ready: boolean
}
const tracks = new Map<string, Track>()
/** 再生位置（曲のサンプル）と、それを受け取った時刻（performance.now。間は時計で進める） */
let pos = 0
/** null の間は位置を進めない（再生が始まる前） */
let posAt: number | null = null
let playing = false
let timer: ReturnType<typeof setTimeout> | null = null

const now = () => pos + (posAt === null ? 0 : ((performance.now() - posAt) / 1000) * sampleRate)
const align = (f: number) => Math.floor(f / QUANTUM) * QUANTUM

/** 作ってある先を捨てて、再生位置の少し先から作り直す（編集したとき） */
function rewind(t: Track) {
  if (!playing) return
  const from = align(now() + SAFE * sampleRate)
  if (t.write <= from) return
  t.write = from
  t.port.postMessage({ type: 'drop', from } satisfies ReaderMessage)
}

/** 再生位置の AHEAD 先まで作る。追いついたら少し待ってまた見る（助走の間は長めに回す） */
function pump() {
  timer = null
  if (!playing) return
  const until = now() + AHEAD * sampleRate
  const started = performance.now()
  const budget = [...tracks.values()].some((t) => !t.ready) ? 100 : 20
  const qL = new Float32Array(QUANTUM)
  const qR = new Float32Array(QUANTUM)
  for (const [id, t] of tracks) {
    // 助走（プラグインの余韻などの状態を作る。送らない）
    while (t.write < t.discard && performance.now() - started < budget) {
      t.stream.render(t.write, qL, qR)
      t.write += QUANTUM
    }
    if (t.write < t.discard) continue
    // 遅れていれば、今の位置から（過ぎた所は作っても鳴らない）
    if (t.write < now()) t.write = align(now())
    while (t.write < until && performance.now() - started < budget) {
      const L = new Float32Array(BLOCK)
      const R = new Float32Array(BLOCK)
      for (let i = 0; i < BLOCK; i += QUANTUM) {
        t.stream.render(t.write + i, qL, qR)
        L.set(qL, i)
        R.set(qR, i)
      }
      t.port.postMessage({ type: 'block', frame: t.write, L, R } satisfies ReaderMessage, [L.buffer, R.buffer])
      t.write += BLOCK
      if (!t.ready) {
        t.ready = true
        // 最初の分を送った（メインは、これを待ってから鳴らし始める）
        scope.postMessage({ type: 'ready', id })
      }
    }
  }
  timer = setTimeout(pump, 10)
}

scope.onmessage = (e) => {
  const m = e.data
  if (m.type === 'init') {
    sampleRate = m.sampleRate
    installScope(sampleRate)
  } else if (m.type === 'source') {
    if (!loaded.has(m.key)) {
      loadProcessorSource(m.source)
      loaded.add(m.key)
    }
  } else if (m.type === 'clip') clips.set(m.id, { sampleRate: m.sampleRate, channels: m.channels })
  else if (m.type === 'unclip') for (const id of m.ids) clips.delete(id)
  else if (m.type === 'track') {
    let t = tracks.get(m.id)
    if (!t) {
      if (!m.port) return
      const id = m.id
      t = { stream: new TrackStream(sampleRate, clips), port: m.port, write: align(now()), discard: 0, preroll: m.preroll, ready: false }
      t.stream.onState = (index, state) => scope.postMessage({ type: 'state', id, index, state })
      tracks.set(m.id, t)
    }
    t.preroll = m.preroll
    try {
      t.stream.setSlots(m.slots)
    } catch (err) {
      // processor を作れなかった（読み込めていない、例外）。メインに知らせて、ノードで鳴らす側に戻してもらう
      scope.postMessage({ type: 'failed', id: m.id, error: String(err) })
      tracks.delete(m.id)
      return
    }
    t.stream.setGain(m.gain)
    t.stream.setVoices(m.voices, now() / sampleRate, m.smooth)
    if (m.rewind) rewind(t)
  } else if (m.type === 'remove') tracks.delete(m.id)
  else if (m.type === 'play') {
    pos = m.frame
    posAt = null
    playing = true
    // 始めた位置の少し前（余韻の長さ）から流して、プラグインの状態を作ってから送る
    for (const t of tracks.values()) {
      t.discard = align(pos)
      t.write = Math.max(0, align(pos - t.preroll * sampleRate))
      t.ready = false
    }
    if (timer) clearTimeout(timer)
    pump()
  } else if (m.type === 'pos') {
    pos = m.frame
    posAt = performance.now()
  } else if (m.type === 'stop') {
    playing = false
    if (timer) clearTimeout(timer)
    timer = null
  }
}
