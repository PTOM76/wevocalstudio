// 設定のダイアログ（PevenMUI の設定画面に、分類と中身を渡す。WeVocalSynth と同じ）
import { SettingsDialog as PevenSettingsDialog } from 'pevenmui'
import { useT } from '../i18n'
import { DEFAULT_SETTINGS, type Settings } from './settings'
import { settingsCategories } from './settingsSearch'
import { settingsPages } from './SettingsPages'

/**
 * 設定画面。PC は左の分類から選んで右で変え、「OK」「適用」で反映、保存し、「キャンセル」なら捨てる。
 * スマホは分類の一覧から各画面へ進み、変更はその場で反映する
 */
export default function SettingsDialog(p: { open: boolean; onClose: () => void; settings: Settings; onChange: (patch: Partial<Settings>) => void }) {
  const t = useT()
  return (
    <PevenSettingsDialog
      open={p.open}
      onClose={p.onClose}
      title={t('settings.title')}
      settings={p.settings}
      defaults={DEFAULT_SETTINGS}
      onChange={p.onChange}
      categories={settingsCategories(t)}
      initial="general"
      pages={(draft, set) => settingsPages({ draft, set, t, onClose: p.onClose })}
    />
  )
}
