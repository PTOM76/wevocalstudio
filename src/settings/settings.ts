// 設定の保存と読み込み、Context（PevenMUI の createSettingsStore。WeVocalSynth と同じ）。項目の定義は items/ にある
import { createSettingsStore } from 'pevenmui'
import { app } from '../appConfig'
import { DEFAULT_SETTINGS, type Settings } from './items'

export { DEFAULT_SETTINGS, type Settings }
export type { ThemeSetting } from './items/display'

/** 名前を変えた設定の、古い名前で保存した値を新しい名前に移す（起動時に 1 回） */
function migrate(key: string) {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return
    const s = JSON.parse(raw) as Record<string, unknown>
    const renamed: [string, string][] = [
      ['follow', 'followPlayhead'],
      ['keys', 'keymap'],
    ]
    let changed = false
    for (const [from, to] of renamed) {
      if (!(from in s)) continue
      if (!(to in s)) s[to] = s[from]
      delete s[from]
      changed = true
    }
    if (changed) localStorage.setItem(key, JSON.stringify(s))
  } catch {
    // 読めない、書けないときは、そのまま既定値で始める
  }
}
migrate(app.key('settings'))

const store = createSettingsStore<Settings>(app.key('settings'), DEFAULT_SETTINGS)
/** localStorage から読む（描画の前に使う。起動時のウィンドウの枠） */
export const loadSettings = store.load
/** アプリの設定（localStorage に保存） */
export const useSettings = store.useSettings
/** 設定を持ち、内側の部品とフックに渡す（main.tsx で App を包む） */
export const SettingsProvider = store.SettingsProvider
/** 設定を読む（SettingsProvider の中だけで使える） */
export const useAppSettings = store.useAppSettings
