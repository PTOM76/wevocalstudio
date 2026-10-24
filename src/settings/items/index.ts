// 設定の項目をまとめ、型と既定値を作る（PevenMUI の collectItems。WeVocalSynth と同じ形）
import { collectItems, type ItemsOf, type SettingsOf } from 'pevenmui'
import { debug, debugAudio, experimental } from './debug'
import { display, stored, view } from './display'
import { edit, file, general, keys } from './general'
import { analysis, grid, pitch, tempo, vocal } from './process'

/** すべての項目の集まり。設定を足すときは、分類のファイルに 1 行足す */
export const GROUPS = [general, edit, grid, keys, file, display, view, stored, pitch, analysis, tempo, vocal, debug, debugAudio, experimental] as const

const collected = collectItems(GROUPS)
/** 項目の定義（名前から引く） */
export const ITEMS = collected.items
/** アプリの設定 */
export type Settings = SettingsOf<ItemsOf<typeof GROUPS>>
export const DEFAULT_SETTINGS: Settings = collected.defaults
