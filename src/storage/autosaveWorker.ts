// 自動保存の書き込みと読み出しをする Worker。数十〜百 MB の元の音の複製と保存を画面のスレッドから外す（WeVocalSynth と同じ）
import { idbClear, idbDelete, idbGet, idbGetMany, idbKeys, idbPut } from './idb'
import { dataFolder } from './dataFolder'

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
  | { type: 'getMany'; keys: string[]; id: number }
  /** 指定したフォルダーにも写すか（設定の「指定したフォルダーに保存する」。dataFolder.ts） */
  | { type: 'folder'; on: boolean }

export interface AutosaveReply {
  id: number
  value?: unknown
  values?: unknown[]
  error?: string
}

const scope = self as unknown as Worker
const building = new Map<string, Float32Array[]>()

/** 指定したフォルダーにも写すか */
let mirror = false
const mirrorFailed = (err: unknown) => console.warn('mirror failed', err)
/** IndexedDB に書いたあとで、フォルダーにも写す（失敗しても自動保存は止めない） */
const put = async (key: string, value: unknown) => {
  await idbPut(key, value)
  if (mirror && dataFolder.isMirroredKey(key)) await dataFolder.mirrorPut(key, value).catch(mirrorFailed)
}
const remove = async (keys: string[]) => {
  await idbDelete(keys)
  if (mirror) await dataFolder.mirrorDelete(keys.filter(dataFolder.isMirroredKey)).catch(mirrorFailed)
}

// 書き込みは届いた順に 1 つずつ行う（同じキーへの書き込みが追い越さないように）
let queue = Promise.resolve()
const write = (op: () => Promise<unknown>) => {
  queue = queue.then(op).then(
    () => {},
    (err) => console.warn('autosave failed', err),
  )
}

const transferables = (values: unknown[]) =>
  values.flatMap((value) => (Array.isArray(value) ? value.filter((v) => v instanceof Float32Array).map((v: Float32Array) => v.buffer) : []))

scope.onmessage = (e: MessageEvent<AutosaveMessage>) => {
  const m = e.data
  switch (m.type) {
    case 'put':
      return write(() => put(m.key, m.value))
    case 'delete':
      return write(() => remove(m.keys))
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
      if (channels) write(() => put(m.key, channels))
      return
    }
    case 'folder': {
      const was = mirror
      mirror = m.on
      // オンにしたら、今ある作業をまとめて写す（このあと変わったものは、書くたびに写す）
      if (m.on && !was)
        write(async () => {
          for (const key of await idbKeys('autosave')) await dataFolder.mirrorPut(key, await idbGet(key)).catch(mirrorFailed)
        })
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
      return
    case 'getMany':
      // 全件を別々に開かず、1 回の読み取りトランザクションでまとめて取得する
      queue
        .then(() => idbGetMany(m.keys))
        .then(
          (values) => scope.postMessage({ id: m.id, values } satisfies AutosaveReply, transferables(values)),
          (err) => scope.postMessage({ id: m.id, error: String(err) } satisfies AutosaveReply),
        )
  }
}
