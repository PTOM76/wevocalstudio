// アプリ全体のダイアログ（ショートカット、履歴、書き出し、設定、ライセンス、バージョン情報。WeVocalSynth の AppDialogs と同じ役目）
import { useMemo, useRef, type ComponentProps } from 'react'
import KanaCutDialog from 'wevocalanalyzer/KanaCutDialog'
import { placeMorae } from './sampler'
import { segmentOf } from './useExtract'
import { Link } from '@mui/material'
import { AUDIO_ACCEPT, flatEq, segmentAt, tempoSegments } from 'wevocal-lib'
import BlockDialog from './BlockDialog'
import type { Dialogs } from './useDialogs'
import { AboutDialog, HistoryDialog, LicensesDialog, RenameDialog } from 'pevenmui'
import type { Clip } from 'wevocal-lib'
import { videoLook, type VideoLook } from 'wevocalconverter/host'
import VideoExportDialog, { type VideoExportSettings } from 'wevocalconverter/VideoExportDialog'
import { kanaHost, videoHost } from './addons'
import type { Range } from 'wevocal-lib'
import { EqDialog, ExportDialog, MarkerTempoDialog, SamplerDialog, SynthDialog, type ExportSettings } from 'wevocal-lib/react'
import { placeOnNotes } from './sampler'
import { addClipTrack } from './project'
import { AppIcon } from './AppHeader'
import { app } from './appConfig'
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
  onVideoExport: (v: VideoExportSettings, look: VideoLook, win?: Window | null) => void
  fail: (e: unknown) => void
  /** 再生中か、再生と一時停止の切り替え（EQ を開いたまま聞く） */
  playing: boolean
  onTogglePlay: () => void
  /** 編集カーソル（作った音、並べた音符を置く位置） */
  cursor: number
  /** ボーカルと伴奏に分ける関数を用意する（一音ずつ切り出しで使う） */
  prepareSeparate: ComponentProps<typeof KanaCutDialog>['prepareSeparate']
  /** 追加機能の導入を確かめる */
  ensure: (id: string) => Promise<boolean>
}) {
  const t = useT()
  const { dialogs, doc } = p
  const { project } = doc
  // プロパティを開いている波形ブロック（複数なら一括で変える）、編集しているマーカー、EQ を開いているトラック
  const editing = dialogs.arg<string[]>('block') ?? []
  const marker = project.markers.find((m) => m.id === dialogs.arg<string>('marker')) ?? null
  const tempoMarker = project.markers.find((m) => m.id === dialogs.arg<string>('markerTempo')) ?? null
  const eqOf = project.tracks.find((tr) => tr.id === dialogs.arg<string>('eq'))
  const sourceInput = useRef<HTMLInputElement>(null)
  // 一音ずつ切り出す波形ブロックと、その音（元の音の、波形ブロックが使っている範囲）
  const kanaBlock = project.blocks.find((b) => b.id === dialogs.arg<string>('kanaCut'))
  const kanaClip = useMemo(() => kanaBlock && segmentOf(project, kanaBlock), [kanaBlock?.id])
  return (
    <>
      <ShortcutsDialog open={dialogs.isOpen('shortcuts')} onClose={dialogs.closer('shortcuts')} />
      {/* 編集の履歴（PevenMUI の HistoryDialog。WeVocalSynth と同じ）。一番上は開いたとき */}
      <HistoryDialog
        open={dialogs.isOpen('history')}
        labels={p.doc.steps.slice(1).map((k) => t(k))}
        done={p.doc.stepIndex}
        onJump={p.doc.goto}
        onClose={dialogs.closer('history')}
        text={{ title: t('history.title'), opened: t('history.opened'), current: t('history.current') }}
      />
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
            'ソースコード',
            <Link className="selectable" href={app.repository} target="_blank" rel="noopener noreferrer">
              {app.repository.replace('https://', '')}
            </Link>,
          ],
        ]}
      />
      {eqOf && (
        // グラフィック EQ（wevocal-lib の EqDialog。WeVocalSynth と同じ。元の音は書き換えないので「適用」はない）
        <EqDialog
          t={t}
          open
          playing={p.playing}
          onTogglePlay={p.onTogglePlay}
          busy={false}
          trackName={eqOf.name}
          eq={eqOf.eq ?? flatEq()}
          onChange={(eq) => doc.updateTrack(eqOf.id, { eq }, `eq:${eqOf.id}`)}
          onClose={() => {
            doc.endMerge()
            dialogs.close('eq')
          }}
        />
      )}
      {/* 音を 0 から作り、編集カーソルの位置に新しいトラックとして置く（wevocal-lib。WeVocalSynth と同じ） */}
      <SynthDialog
        t={t}
        open={dialogs.isOpen('synth')}
        bpm={project.tempo.bpm}
        onClose={dialogs.closer('synth')}
        onCreate={(clip, name) => {
          doc.apply((q) => addClipTrack(q, clip, name, p.cursor))
          dialogs.close('synth')
        }}
      />
      {/* 選んだ波形ブロックを MIDI の音符に並べる（wevocal-lib のダイアログ。並べ方は sampler.ts） */}
      <SamplerDialog
        t={t}
        open={dialogs.isOpen('sampler')}
        bpm={project.tempo.bpm}
        baseNote={null}
        onClose={dialogs.closer('sampler')}
        onRun={(o) => {
          const id = dialogs.arg<string>('sampler')
          if (id) doc.apply((q) => placeOnNotes(q, id, o.notes, o.baseNote, o.fit, p.cursor, o.midiName))
          dialogs.close('sampler')
        }}
      />
      {/* 動画の書き出し（ダイアログと手順は converter。WeVocalSynth と同じ） */}
      {dialogs.isOpen('video') && (
        <VideoExportDialog
          t={t}
          host={videoHost}
          open
          onClose={dialogs.closer('video')}
          baseName={p.fileName}
          hasSelection={!!p.range}
          trackCount={1}
          busy={false}
          progress={0}
          previewClip={dialogs.arg<Clip>('video')!}
          prefs={p.settings.exportVideo}
          onPrefsChange={(exportVideo) => p.onSettingsChange({ exportVideo })}
          onExport={(v, win) => p.onVideoExport(v, videoLook(p.settings.exportVideo, v.image, v.fileName.trim()), win)}
        />
      )}
      {/* 一音ずつ切り出す（ダイアログと手順は analyzer。WeVocalSynth と同じ）。結果は一音ずつの波形ブロックにして新しいトラックに並べる */}
      {kanaBlock && kanaClip && (
        <KanaCutDialog
          t={t}
          host={kanaHost}
          open
          onClose={dialogs.closer('kanaCut')}
          clip={kanaClip}
          range={{ start: 0, end: kanaClip.channels[0].length / kanaClip.sampleRate }}
          ensure={p.ensure}
          prepareSeparate={p.prepareSeparate}
          vocalBefore={p.settings.vocalBeforeAnalysis}
          onVocalBeforeChange={(vocalBeforeAnalysis) => p.onSettingsChange({ vocalBeforeAnalysis })}
          onDone={(morae) => {
            const name = project.tracks.find((tr) => tr.id === kanaBlock.track)?.name ?? ''
            doc.apply((q) => placeMorae(q, kanaBlock.id, morae, t('kanaCut.trackName', { name })))
            dialogs.close('kanaCut')
          }}
        />
      )}
      {/* トラックの名前の変更（PevenMUI の RenameDialog） */}
      <RenameDialog
        name={project.tracks.find((tr) => tr.id === dialogs.arg<string>('renameTrack'))?.name ?? null}
        title={t('track.rename')}
        onClose={dialogs.closer('renameTrack')}
        onRename={(name) => {
          const id = dialogs.arg<string>('renameTrack')
          if (id) doc.updateTrack(id, { name: name.trim() })
        }}
      />
      {/* マーカーの名前の変更（PevenMUI の RenameDialog）と、ここからのテンポ（wevocal-lib の MarkerTempoDialog。WeVocalSynth と同じ） */}
      <RenameDialog name={marker?.name ?? null} title={t('marker.rename')} onClose={dialogs.closer('marker')} onRename={(name) => marker && doc.updateMarker(marker.id, { name: name.trim() })} />
      <MarkerTempoDialog
        t={t}
        marker={tempoMarker}
        current={tempoMarker ? segmentAt(tempoSegments(project.tempo, project.markers.filter((m) => m.id !== tempoMarker.id)), tempoMarker.time) ?? project.tempo : project.tempo}
        onClose={dialogs.closer('markerTempo')}
        onChange={(tempo) => tempoMarker && doc.updateMarker(tempoMarker.id, { tempo })}
      />
      <BlockDialog
        blocks={project.blocks.filter((b) => editing.includes(b.id))}
        sources={project.sources}
        onClose={dialogs.closer('block')}
        onApply={(edit) => doc.editBlocks(editing, edit)}
        onPickFile={() => sourceInput.current?.click()}
        presets={p.settings.presets}
        onPresetsChange={(presets) => p.onSettingsChange({ presets })}
        showLegacy={p.settings.showLegacyAlgorithms}
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
