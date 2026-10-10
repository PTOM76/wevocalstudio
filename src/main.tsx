// 起動。設定を読み、言語、テーマ、画面の大きさを PevenProvider に渡す
import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { useColorScheme } from '@mui/material'
import '@fontsource/roboto/400.css'
import '@fontsource/roboto/500.css'
import { PevenProvider, WindowLimitScreen, preventPageZoom, setUiScale } from 'pevenmui'
import { acquireSlot, configureWindowSlots } from 'pevenmui/web'
import App from './App'
import { app } from './appConfig'
import { i18n, t } from './i18n'
import { loadSettings, useSettings, type Settings } from './settings/settings'

preventPageZoom()

/** 設定のテーマを反映する（ThemeProvider の内側で呼ぶ） */
function ThemeSync({ theme }: { theme: Settings['theme'] }) {
  const { setMode } = useColorScheme()
  useEffect(() => setMode(theme), [theme, setMode])
  return null
}

/** 設定を読み、言語、テーマ、画面の大きさを PevenProvider に渡す */
function Root() {
  const { settings, update } = useSettings()
  useEffect(() => setUiScale(settings.uiScale), [settings.uiScale])
  return (
    <PevenProvider desktopLook app={app} i18n={i18n} lang={i18n.resolve(settings.language)}>
      <ThemeSync theme={settings.theme} />
      <App settings={settings} onSettingsChange={update} />
    </PevenProvider>
  )
}

/** 上限で開けなかったときの画面（WeVocalSynth と同じ） */
function Limit({ max }: { max: number }) {
  const settings = loadSettings()
  i18n.setLang(i18n.resolve(settings.language))
  return <WindowLimitScreen message={t('window.limit', { n: max })} hint={t('window.limitHint')} retry={t('window.retry')} close={t('common.close')} />
}

// 最初に、このウィンドウの枠を取る（自動保存のキーが決まる。PevenMUI の windowSlot）。上限で、超えて開く設定でなければ作業を開かない
configureWindowSlots(app.key(''))
const boot = loadSettings()
void acquireSlot(boot.maxWindows).then((slot) =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      {slot === null && !boot.extraWindows ? (
        <PevenProvider desktopLook app={app}>
          <Limit max={boot.maxWindows} />
        </PevenProvider>
      ) : (
        <Root />
      )}
    </StrictMode>,
  ),
)
