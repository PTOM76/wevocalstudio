// アプリ全体のダイアログ（ショートカット、履歴、書き出し、設定、ライセンス、バージョン情報。WeVocalSynth の AppDialogs と同じ役目）
import { Link } from '@mui/material'
import { AboutDialog, LicensesDialog } from 'pevenmui'
import type { Range } from 'wevocal-lib'
import { ExportDialog, type ExportSettings } from 'wevocal-lib/react'
import { AppIcon } from './AppHeader'
import { app } from './appConfig'
import HistoryDialog from './HistoryDialog'
import { useT } from './i18n'
import SettingsDialog from './settings/SettingsDialog'
import type { Settings } from './settings/settings'
import ShortcutsDialog from './ShortcutsDialog'
import type { useProject } from './useProject'

/** アプリ全体のダイアログの名前 */
export type AppDialog = 'settings' | 'about' | 'licenses' | 'export' | 'history' | 'shortcuts'

/** 今動いている版 */
const BUILD = `${__APP_VERSION__} (${__APP_COMMIT__})`

export default function AppDialogs(p: {
  dialog: AppDialog | null
  onClose: () => void
  settings: Settings
  onSettingsChange: (patch: Partial<Settings>) => void
  doc: ReturnType<typeof useProject>
  fileName: string
  range: Range | null
  onExport: (s: ExportSettings, win?: Window | null) => void
}) {
  const t = useT()
  return (
    <>
        <ShortcutsDialog open={p.dialog === 'shortcuts'} onClose={() => p.onClose()} />
        <HistoryDialog open={p.dialog === 'history'} steps={p.doc.steps} index={p.doc.stepIndex} onGoto={p.doc.goto} onClose={() => p.onClose()} />
        <ExportDialog
          t={t}
          open={p.dialog === 'export'}
          onClose={() => p.onClose()}
          baseName={p.fileName}
          sourceRate={48000}
          sourceChannels={2}
          hasSelection={!!p.range}
          trackCount={1}
          busy={false}
          progress={0}
          onExport={p.onExport}
          finish={{ normalize: p.settings.exportNormalize, fadeMs: p.settings.exportFadeMs }}
          onFinishChange={(f) => p.onSettingsChange({ exportNormalize: f.normalize, exportFadeMs: f.fadeMs })}
        />
        <SettingsDialog open={p.dialog === 'settings'} onClose={() => p.onClose()} settings={p.settings} onChange={p.onSettingsChange} />
        <LicensesDialog
          open={p.dialog === 'licenses'}
          onClose={() => p.onClose()}
          title={t('menu.licenses')}
          entries={[
            { name: app.name, license: 'MIT', url: app.repository, note: t('licenses.app') },
            { name: 'PevenMUI', license: 'MIT', url: 'https://github.com/PTOM76/pevenmui' },
            { name: 'wevocal-lib', license: 'MIT', url: 'https://github.com/PTOM76/wevocal-lib' },
            { name: 'React', license: 'MIT', url: 'https://react.dev/' },
            { name: 'MUI', license: 'MIT', url: 'https://mui.com/' },
            { name: 'Font Awesome Free', license: 'CC BY 4.0 / MIT', url: 'https://fontawesome.com/' },
            { name: 'Roboto', license: 'OFL-1.1', url: 'https://fonts.google.com/specimen/Roboto' },
          ]}
        />
        <AboutDialog
          open={p.dialog === 'about'}
          onClose={() => p.onClose()}
          icon={<AppIcon size={56} />}
          rows={[
            [t('about.version'), <span className="selectable">{BUILD}</span>],
            [t('about.author'), app.author],
            [
              'GitHub',
              <Link className="selectable" href={app.repository} target="_blank" rel="noopener noreferrer">
                {app.repository.replace('https://', '')}
              </Link>,
            ],
          ]}
        />
    </>
  )
}
