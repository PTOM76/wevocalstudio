// このアプリの IndexedDB（PevenMUI の createIdb。WeVocalSynth と同じ）。画面と自動保存の Worker の両方から使う
import { createIdb } from 'pevenmui/web'
import { APP_INFO } from '../appInfo'

const db = createIdb(APP_INFO.id)
/** そのまま渡すとき（追加機能の保存先など） */
export const idb = db

export const idbGet = db.get
export const idbPut = db.put
/** いくつかのキーを消す */
export const idbDelete = async (keys: string[]) => {
  for (const k of keys) await db.delete(k)
}
/** 保存したものをすべて消す（設定の「作業データを削除」） */
export const idbClear = () => db.clear()
