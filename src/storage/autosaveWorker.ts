// 自動保存の書き込みと読み出しをする Worker。数十〜百 MB の元の音の複製と保存を画面のスレッドから外す（WeVocalSynth と同じ）
import { idbClear, idbDelete, idbGet, idbPut } from './idb'

/**
 * 画面から送るメッセージ。元の音は begin → chunk（小分け。所有権ごと渡すので複製しない）→ end の順に送り、ここで組み立ててから書く
 */
export type AutosaveMessage =
  | { type: 'put'; key: string; value: unknown }
  | { type: 'delete'; keys: string[] }
  | { type: 'clear' }
  | { type: 'begin'; key: string; channels: number; length: number }
  | { type: 'chunk'; key: string; channel: number; offset: number; data: Float32Array }
  | { type: 'end'; key: string }
  /** 読み出し（起動時の復元）。元の音は所有権ごと返す */
  | { type: 'get'; key: string; id: number }

export interface AutosaveReply {
  id: number
  value?: unknown
  error?: string
}

const scope = self as unknown as Worker
const building = new Map<string, Float32Array[]>()

// 書き込みは届いた順に 1 つずつ行う（同じキーへの書き込みが追い越さないように）
let queue = Promise.resolve()
const write = (op: () => Promise<unknown>) => {
  queue = queue.then(op).then(
    () => {},
    (err) => console.warn('autosave failed', err),
  )
}

scope.onmessage = (e: MessageEvent<AutosaveMessage>) => {
  const m = e.data
  switch (m.type) {
    case 'put':
      return write(() => idbPut(m.key, m.value))
    case 'delete':
      return write(() => idbDelete(m.keys))
    case 'clear':
      building.clear()
      return write(idbClear)
    case 'begin':
      building.set(m.key, Array.from({ length: m.channels }, () => new Float32Array(m.length)))
      return
    case 'chunk':
      building.get(m.key)?.[m.channel].set(m.data, m.offset)
      return
    case 'end': {
      const channels = building.get(m.key)
      building.delete(m.key)
      if (channels) write(() => idbPut(m.key, channels))
      return
    }
    case 'get':
      // 書きかけのものを待ってから読む
      queue
        .then(() => idbGet(m.key))
        .then(
          (value) => {
            const transfer = Array.isArray(value) ? value.filter((v) => v instanceof Float32Array).map((v: Float32Array) => v.buffer) : []
            scope.postMessage({ id: m.id, value } satisfies AutosaveReply, transfer)
          },
          (err) => scope.postMessage({ id: m.id, error: String(err) } satisfies AutosaveReply),
        )
  }
}
