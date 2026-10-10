// アプリ全体のダイアログ（ショートカット、履歴、書き出し、設定、ライセンス、バージョン情報。WeVocalSynth の AppDialogs と同じ役目）
import { useRef } from 'react'
import { Link } from '@mui/material'
import { AUDIO_ACCEPT, flatEq } from 'wevocal-lib'
import BlockDialog from './BlockDialog'
import EqDialog from './EqDialog'
import MarkerDialog from './MarkerDialog'
import type { Dialogs } from './useDialogs'
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

/** 今動いている版 */
const BUILD = `${__APP_VERSION__} (${__APP_COMMIT__})`

export default function AppDialogs(p: {
  dialogs: Dialogs
  settings: Settings
  onSettingsChange: (patch: Partial<Settings>) => void
  doc: ReturnType<typeof useProject>
  fileName: string
  range: Range | null
  onExport: (s: ExportSettings, win?: Window | null) => void
  fail: (e: unknown) => void
}) {
  const t = useT()
  const { dialogs, doc } = p
  const { project } = doc
  // プロパティを開いている波形ブロック（複数なら一括で変える）、編集しているマーカー、EQ を開いているトラック
  const editing = dialogs.arg<string[]>('block') ?? []
  const marker = project.markers.find((m) => m.id === dialogs.arg<string>('marker')) ?? null
  const eqOf = project.tracks.find((tr) => tr.id === dialogs.arg<string>('eq'))
  const sourceInput = useRef<HTMLInputElement>(null)
  return (
    <>
      <ShortcutsDialog open={dialogs.isOpen('shortcuts')} onClose={dialogs.closer('shortcuts')} />
      <HistoryDialog open={dialogs.isOpen('history')} steps={p.doc.steps} index={p.doc.stepIndex} onGoto={p.doc.goto} onClose={dialogs.closer('history')} />
      <ExportDialog
        t={t}
        open={dialogs.isOpen('export')}
        onClose={dialogs.closer('export')}
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
      <SettingsDialog open={dialogs.isOpen('settings')} onClose={dialogs.closer('settings')} settings={p.settings} onChange={p.onSettingsChange} />
      <LicensesDialog
        open={dialogs.isOpen('licenses')}
        onClose={dialogs.closer('licenses')}
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
        open={dialogs.isOpen('about')}
        onClose={dialogs.closer('about')}
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
      {eqOf && (
        <EqDialog
          open
          trackName={eqOf.name}
          eq={eqOf.eq ?? flatEq()}
          onChange={(eq) => doc.updateTrack(eqOf.id, { eq }, `eq:${eqOf.id}`)}
          onClose={() => {
            doc.endMerge()
            dialogs.close('eq')
          }}
        />
      )}
      <MarkerDialog
        marker={marker}
        onClose={dialogs.closer('marker')}
        bpm={project.tempo.bpm}
        beatsPerBar={project.tempo.beatsPerBar}
        onChange={(patch) => marker && doc.updateMarker(marker.id, patch)}
        onRemove={() => marker && doc.removeMarker(marker.id)}
      />
      <BlockDialog
        blocks={project.blocks.filter((b) => editing.includes(b.id))}
        sources={project.sources}
        onClose={dialogs.closer('block')}
        onApply={(edit) => doc.editBlocks(editing, edit)}
        onPickFile={() => sourceInput.current?.click()}
      />
      {/* プロパティの「ファイルから」で選ぶ元の音 */}
      <input
        ref={sourceInput}
        type="file"
        accept={AUDIO_ACCEPT}
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) doc.replaceSource(editing, file).then(() => dialogs.close('block'), p.fail)
        }}
      />
    </>
  )
}
