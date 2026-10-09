// アプリの設定（localStorage に保存する）
import { useState } from 'react'
import type { Algorithm } from 'wevocal-lib'
import type { KeymapOverrides } from 'pevenmui'
import type { GridDivision, GridMode } from './grid'
import type { Action } from './keymap'
import type { LangSetting } from './i18n'
import { app } from './appConfig'

/** アプリの設定（localStorage に保存する）。項目を足したら DEFAULT_SETTINGS にも足す */
export interface Settings {
  theme: 'system' | 'light' | 'dark'
  language: LangSetting
  /** 画面の大きさ（倍率） */
  uiScale: number
  showStatusBar: boolean
  /** ミニマップ（全体を縮めた波形）を出す */
  showMinimap: boolean
  /** レベルメーター（WeVocalSynth と同じ） */
  showMeters: boolean
  /** 解析の欄（WeVocalAnalyzer のスペクトログラムと F0）を出す */
  showAnalysis: boolean
  /** 作業を自動保存し、次に開いたときに復元する */
  autoRestore: boolean
  /** ドラッグを目盛りの線や波形ブロックの端に吸い付ける */
  snap: boolean
  /** 再生中に表示を再生位置に追従させる */
  follow: boolean
  /** 時間軸の線を拍と小節で取るか、秒で取るか */
  grid: GridMode
  /** グリッドの細かさ（音符。1/1〜1/256） */
  gridDivision: GridDivision
  /** 録音の入力元（'' は既定の入力） */
  inputDevice: string
  /** 既定から変えたキーの割り当て */
  keys: KeymapOverrides<Action>
  /** 新しい波形ブロックのピッチの処理方式（WeVocalSynth と同じ。既定は Synth の声と同じ Vesola）。波形ブロックごとに変えられる */
  algorithm: Algorithm
  /** 新しい波形ブロックでフォルマント（声の響き）を保つか */
  preserveFormant: boolean
}

export const DEFAULT_SETTINGS: Settings = { theme: 'system', language: 'auto', uiScale: 1, showStatusBar: true, showMinimap: true, showMeters: true, showAnalysis: false, snap: true, follow: true, grid: 'beats', gridDivision: 4, keys: {}, inputDevice: '', autoRestore: true, algorithm: 'sola3', preserveFormant: true }

const KEY = app.key('settings')

function load(): Settings {
  try {
    // 古い設定に無い項目は既定値で埋める
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
  } catch {
    return DEFAULT_SETTINGS
  }
}

/** 設定と、一部を変えて保存する関数 */
export function useSettings() {
  const [settings, setSettings] = useState(load)
  const update = (patch: Partial<Settings>) =>
    setSettings((s) => {
      const next = { ...s, ...patch }
      try {
        localStorage.setItem(KEY, JSON.stringify(next))
      } catch {
        // 保存できなくても、このセッション中は使う
      }
      return next
    })
  return [settings, update] as const
}
