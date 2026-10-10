// 設定の保存と読み込み、Context（PevenMUI の createSettingsStore。WeVocalSynth と同じ）。項目の定義は items/ にある
import { createSettingsStore } from 'pevenmui'
import { app } from '../appConfig'
import { DEFAULT_SETTINGS, type Settings } from './items'

export { DEFAULT_SETTINGS, type Settings }
export type { ThemeSetting } from './items/display'

const store = createSettingsStore<Settings>(app.key('settings'), DEFAULT_SETTINGS)
/** localStorage から読む（描画の前に使う。起動時のウィンドウの枠） */
export const loadSettings = store.load
/** アプリの設定（localStorage に保存） */
export const useSettings = store.useSettings
/** 設定を持ち、内側の部品とフックに渡す（main.tsx で App を包む） */
export const SettingsProvider = store.SettingsProvider
/** 設定を読む（SettingsProvider の中だけで使える） */
export const useAppSettings = store.useAppSettings
