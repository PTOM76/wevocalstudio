// 起動。設定を読み、言語、テーマ、画面の大きさを PevenProvider に渡す
import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { useColorScheme } from '@mui/material'
import '@fontsource/roboto/400.css'
import '@fontsource/roboto/500.css'
import { PevenProvider, preventPageZoom, setUiScale } from 'pevenmui'
import App from './App'
import { app } from './appConfig'
import { i18n } from './i18n'
import { useSettings, type Settings } from './settings/settings'

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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
