// 設定の「プラグイン」（導入と管理。部品は wevocal-lib の PluginManager。WeVocalSynth と共通）
import { PluginManager } from 'wevocal-lib/react'
import { i18n, useT } from '../i18n'

/** vst: 試験的機能の VST の導入口を出すか（設定の開発者向け。編集中の設定 draft の値を、設定画面から渡す。ダイアログは SettingsProvider の外にも出るので、フックで読まない） */
export default function PluginsSection({ vst }: { vst: boolean }) {
  const t = useT()
  return <PluginManager t={t} lang={i18n.useLang()} vst={vst} />
}
