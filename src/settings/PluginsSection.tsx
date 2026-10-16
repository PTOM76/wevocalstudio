// 設定の「プラグイン」（導入と管理。部品は wevocal-lib の PluginManager。WeVocalSynth と共通）
import { PluginManager } from 'wevocal-lib/react'
import { i18n, useT } from '../i18n'
import { useAppSettings } from './settings'

export default function PluginsSection() {
  const t = useT()
  // 試験的機能の VST の導入口は、設定の開発者向けでオンにしたときだけ出す
  const { settings } = useAppSettings()
  return <PluginManager t={t} lang={i18n.useLang()} vst={settings.showVst} />
}
