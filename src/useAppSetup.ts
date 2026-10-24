// アプリを開いているあいだ、設定を音の出力とデバッグ表示に反映する（出力先、リミッター、再生のセッション、重いプラグインの素通し、処理の開発者向けの設定、Ctrl+Shift+D）
import { useEffect, useRef } from 'react'
import { configurePlayback, setAutoBypass, setExperimentalAlgorithms, setOutputDevice, setOutputLimit } from 'wevocal-lib'
import { setFastMath } from './dsp/pitch'
import { reportAudioContext } from 'pevenmui/debug'
import type { Settings } from './settings/settings'

export function useAppSetup(settings: Settings, onSettingsChange: (patch: Partial<Settings>) => void) {
  // 出力先とリミッター（wevocal-lib。WeVocalSynth と同じ）
  const { suspendWhenStopped, playbackSession, outputDevice, outputLimit, outputLimitDb, autoBypass } = settings
  useEffect(() => void configurePlayback({ suspendWhenStopped, playbackSession, report: reportAudioContext }), [suspendWhenStopped, playbackSession])
  useEffect(() => setOutputDevice(outputDevice), [outputDevice])
  useEffect(() => setOutputLimit(outputLimit ? outputLimitDb : null), [outputLimit, outputLimitDb])
  useEffect(() => setAutoBypass(autoBypass), [autoBypass])
  // フォルマント補正の速い近似と、試験的な処理方式の表示（設定の開発者向け。WeVocalSynth と同じ）
  useEffect(() => setFastMath(settings.fastMath), [settings.fastMath])
  useEffect(() => setExperimentalAlgorithms(settings.showExperimentalAlgorithms), [settings.showExperimentalAlgorithms])
  // Ctrl+Shift+D でデバッグ表示を切り替える（WeVocalSynth と同じ）
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'KeyD') {
        e.preventDefault()
        onSettingsChange({ showDebug: !settingsRef.current.showDebug })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onSettingsChange])
}
