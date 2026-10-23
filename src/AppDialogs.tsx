// アプリ全体のダイアログ（ショートカット、履歴、書き出し、設定、ライセンス、バージョン情報。WeVocalSynth の AppDialogs と同じ役目）
import { projectBeatMap } from './beats'
import { useMemo, useRef, type ComponentProps } from 'react'
import KanaCutDialog from 'wevocalanalyzer/KanaCutDialog'
import { placeMorae } from './sampler'
import { segmentOf } from './useExtract'
import { Link } from '@mui/material'
import { AUDIO_ACCEPT, segmentAt, tempoSegments } from 'wevocal-lib'
import BlockDialog from './BlockDialog'
import type { Dialogs } from './useDialogs'
import { AboutDialog, HistoryDialog, LicensesDialog, RenameDialog } from 'pevenmui'
import type { Clip } from 'wevocal-lib'
import { videoLook, type VideoLook } from 'wevocalconverter/host'
import VideoExportDialog, { type VideoExportSettings } from 'wevocalconverter/VideoExportDialog'
import { kanaHost, videoHost } from './addons'
import type { Range } from 'wevocal-lib'
import { ExportDialog, FxChainDialog, MarkerTempoDialog, PitchToolText, SamplerDialog, SynthDialog, VibratoDialog, type ExportSettings } from 'wevocal-lib/react'
import { placeOnNotes } from './sampler'
import { addClipTrack } from './project'
import { AppIcon } from './AppHeader'
import { app } from './appConfig'
import { i18n, useT } from './i18n'
import SettingsDialog from './settings/SettingsDialog'
import type { Settings } from './settings/settings'
import OptimizeDialog from './OptimizeDialog'
import GlideDialog from './GlideDialog'
import { glideBlocks } from './glide'
import { vibratoBlocks } from './vibratoEnv'
import type { OptimizeOptions } from './optimize'
import InstrumentDialog from './InstrumentDialog'
import MidiBlockDialog from './MidiBlockDialog'
import MidiImportDialog from './MidiImportDialog'
import { importMidi, type MidiPending } from './midiImport'
import PianoRollDialog from './PianoRollDialog'
import SendDialog from './SendDialog'
import TrackPropertiesDialog, { type TrackPropertyAdd, type TrackPropertyEdit } from './TrackPropertiesDialog'
import ToolDialog from './ToolDialog'
import ShortcutsDialog from './ShortcutsDialog'
import type { useProject } from './useProject'
import { countRender } from 'pevenmui/debug'

/** 今動いている版 */
const BUILD = `${__APP_VERSION__} (${__APP_COMMIT__})`

export default function AppDialogs(p: {
  dialogs: Dialogs
  settings: Settings
  onSettingsChange: (patch: Partial<Settings>) => void
  doc: ReturnType<typeof useProject>
  fileName: string
  onRenameProject: (name: string) => void
  range: Range | null
  onExport: (s: ExportSettings, win?: Window | null) => void
  onOptimize: (o: OptimizeOptions) => void
  onVideoExport: (v: VideoExportSettings, look: VideoLook, win?: Window | null) => void
  fail: (e: unknown) => void
  /** 再生中か、再生と一時停止の切り替え（FX を開いたまま聞く） */
  playing: boolean
  onTogglePlay: () => void
  /** start〜end 秒だけを再生する（loop なら繰り返す） */
  onPlayRange: (start: number, end: number, loop: boolean) => void
  /** 繰り返し（メインの時間軸と同じもの） */
  repeat: boolean
  onRepeat: (repeat: boolean) => void
  /** 編集位置と範囲選択を変える（メインの時間軸と同じもの） */
  onSeek: (time: number) => void
  onRange: (r: Range | null) => void
  /** 再生位置（秒。ピアノロールの再生位置の線） */
  position: () => number
  /** 音を作る処理の負荷（0〜1。測れなければ null） */
  load: number | null
  /** 音源で音を鳴らす、離す（ピアノロール）。トラックの id、高さ、強さ、鳴らすか */
  onPreview: (track: string, pitch: number, vel: number, on: boolean) => void
  /** 編集カーソル（作った音、並べた音符を置く位置） */
  cursor: number
  /** ボーカルと伴奏に分ける関数を用意する（一音ずつ切り出しで使う） */
  prepareSeparate: ComponentProps<typeof KanaCutDialog>['prepareSeparate']
  /** 追加機能の導入を確かめる */
  ensure: (id: string) => Promise<boolean>
}) {
  countRender('AppDialogs')
  const t = useT()
  const { dialogs, doc } = p
  const { project } = doc
  // プロパティを開いている波形ブロック（複数なら一括で変える）、編集しているマーカー、FX を開いているトラック
  const editing = dialogs.arg<string[]>('block') ?? []
  const propertyTrackIds = dialogs.arg<string[]>('trackProperties') ?? []
  const propertyTracks = project.tracks.filter((track) => propertyTrackIds.includes(track.id))
  const marker = project.markers.find((m) => m.id === dialogs.arg<string>('marker')) ?? null
  const tempoMarker = project.markers.find((m) => m.id === dialogs.arg<string>('markerTempo')) ?? null
  const fxId = dialogs.arg<string>('fx')
  const fxTrack = project.tracks.find((tr) => tr.id === fxId)
  const fxTarget = fxId === 'master' ? { id: 'master', name: t('track.master'), slots: project.master.fx ?? [] } : fxTrack && { id: fxTrack.id, name: fxTrack.name, slots: fxTrack.fx ?? [] }
  const lang = i18n.useLang()
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
      <OptimizeDialog open={dialogs.isOpen('optimize')} selected={dialogs.arg<string[]>('optimize') ?? []} onClose={dialogs.closer('optimize')} onRun={p.onOptimize} />
      <GlideDialog
        open={dialogs.isOpen('glidePitch')}
        onClose={dialogs.closer('glidePitch')}
        onApply={({ seconds, shape, tension }) => doc.apply((current) => glideBlocks(current, dialogs.arg<string[]>('glidePitch') ?? [], seconds, shape, tension))}
      />
      {/* ビブラートを、選んだ波形ブロック（範囲があればその中）のピッチのエンベロープとして足す（ダイアログは wevocal-lib。WeVocalSynth のピッチの道具と同じ） */}
      <PitchToolText.Provider value={t}>
        <VibratoDialog
          open={dialogs.isOpen('vibrato')}
          hasSelection={!!p.range}
          bpm={project.tempo.bpm}
          onClose={dialogs.closer('vibrato')}
          onRun={(o) => {
            doc.apply((current) => vibratoBlocks(current, dialogs.arg<string[]>('vibrato') ?? [], p.range, o))
            dialogs.close('vibrato')
          }}
        />
      </PitchToolText.Provider>
      <SettingsDialog
        open={dialogs.isOpen('settings')}
        onClose={dialogs.closer('settings')}
        settings={p.settings}
        onChange={p.onSettingsChange}
        project={{ name: p.fileName, tempo: doc.project.tempo, onRename: p.onRenameProject, onTempoChange: doc.updateTempo }}
      />
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
      {(() => {
        const id = dialogs.arg<string>('pianoRoll')
        const block = (project.midi ?? []).find((b) => b.id === id) ?? null
        return (
          block && (
            <PianoRollDialog
              open
              project={project}
              block={block}
              division={p.settings.gridDivision}
              onDivision={(gridDivision) => p.onSettingsChange({ gridDivision })}
              playing={p.playing}
              position={p.position}
              onTogglePlay={p.onTogglePlay}
              loop={p.repeat}
              onLoop={p.onRepeat}
              onPlayBlock={(loop) => p.onPlayRange(block.start, block.start + block.length, loop)}
              cursor={p.cursor}
              onCursor={p.onSeek}
              range={p.range}
              onRange={p.onRange}
              onLength={(beats, merge) => {
                const map = projectBeatMap(doc.project)
                const b0 = map.toBeat(block.start)
                doc.updateMidiBlock(block.id, { length: Math.max(0.05, map.toSec(b0 + beats) - block.start) }, `${block.id}:${merge}`)
              }}
              onChange={(notes, merge) => doc.updateMidiBlock(block.id, { notes }, merge && `${block.id}:${merge}`)}
              onCurves={(curves, merge) => doc.updateMidiBlock(block.id, { curves }, merge && `${block.id}:${merge}`)}
              onPreview={(pitch, vel, on) => p.onPreview(block.track, pitch, vel, on)}
              onClose={() => {
                doc.endMerge()
                dialogs.close('pianoRoll')
              }}
            />
          )
        )
      })()}
      {(() => {
        const pending = dialogs.arg<MidiPending>('midiImport')
        return (
          pending && (
            <MidiImportDialog
              pending={pending}
              onImport={(o, at) => {
                const q = importMidi(doc.project, pending, at === 'cursor' ? p.cursor : 0, o)
                dialogs.close('midiImport')
                if (q) doc.apply(() => q)
              }}
              onClose={dialogs.closer('midiImport')}
            />
          )
        )
      })()}
      {(() => {
        const id = dialogs.arg<string>('midiProps')
        const block = (project.midi ?? []).find((b) => b.id === id) ?? null
        return (
          block && (
            <MidiBlockDialog
              open
              block={block}
              onChange={(patch, merge) => doc.updateMidiBlock(block.id, patch, merge)}
              onPianoRoll={() => {
                dialogs.close('midiProps')
                dialogs.open('pianoRoll', block.id)
              }}
              onClose={() => {
                doc.endMerge()
                dialogs.close('midiProps')
              }}
            />
          )
        )
      })()}
      {(dialogs.isOpen('tool') || dialogs.isOpen('analyze')) && (
        <ToolDialog
          open
          kind={dialogs.isOpen('tool') ? 'tool' : 'analyzer'}
          project={project}
          ids={doc.selected.filter((id) => project.blocks.some((b) => b.id === id))}
          onApply={(next) => doc.apply(() => next)}
          fail={p.fail}
          onClose={() => dialogs.close(dialogs.isOpen('tool') ? 'tool' : 'analyze')}
        />
      )}
      {dialogs.arg<string>('instrument') && (
        <InstrumentDialog
          open
          project={project}
          track={dialogs.arg<string>('instrument')!}
          onChange={(instrument) => doc.updateTrack(dialogs.arg<string>('instrument')!, { instrument }, `instrument:${dialogs.arg<string>('instrument')}`)}
          onClose={() => {
            doc.endMerge()
            dialogs.close('instrument')
          }}
        />
      )}
      {dialogs.arg<string>('sends') && (
        <SendDialog
          open
          project={project}
          track={dialogs.arg<string>('sends')!}
          onChange={(sends) => doc.updateTrack(dialogs.arg<string>('sends')!, { sends }, `sends:${dialogs.arg<string>('sends')}`)}
          onClose={() => {
            doc.endMerge()
            dialogs.close('sends')
          }}
        />
      )}
      {fxTarget && (
        // FX の列（wevocal-lib の FxChainDialog。WeVocalSynth と同じ。元の音は書き換えない）
        <FxChainDialog
          t={t}
          lang={lang}
          open
          name={fxTarget.name}
          slots={fxTarget.slots}
          dev={p.settings.showDevPlugins}
          onChange={(fx, merge) => (fxTarget.id === 'master' ? doc.updateMaster({ fx }, merge && `master:${merge}`) : doc.updateTrack(fxTarget.id, { fx }, merge && `${fxTarget.id}:${merge}`))}
          playing={p.playing}
          onTogglePlay={p.onTogglePlay}
          load={p.playing ? p.load : null}
          autoLane={fxTarget.id === 'master' ? project.master.autoLane : fxTrack?.autoLane}
          onAutoLane={(lane) => {
            // 時間軸に出すつまみを選んだら、オートメーションの編集に切り替える（エンベロープの編集は止める）
            if (lane) p.onSettingsChange({ autoEdit: true, envelope: false, pitchEnvelope: false })
            if (fxTarget.id === 'master') doc.updateMaster({ autoLane: lane ?? undefined })
            else doc.updateTrack(fxTarget.id, { autoLane: lane ?? undefined })
          }}
          sidechainSources={project.tracks.filter((tr) => tr.id !== fxTarget.id).map((tr) => ({ id: tr.id, name: tr.name }))}
          userPresets={p.settings.fxPresets}
          onUserPresetsChange={(plugin, list) => p.onSettingsChange({ fxPresets: { ...p.settings.fxPresets, [plugin]: list } })}
          onClose={() => {
            doc.endMerge()
            dialogs.close('fx')
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
          doc.apply((q) => addClipTrack(q, clip, name, p.cursor, p.settings.defaultBlockFade ? p.settings.defaultBlockFadeMs / 1000 : 0))
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
      <TrackPropertiesDialog
        open={dialogs.isOpen('trackProperties')}
        tracks={propertyTracks}
        onClose={dialogs.closer('trackProperties')}
        onApply={(edit: TrackPropertyEdit, add: TrackPropertyAdd) => {
          const patches = Object.fromEntries(
            propertyTracks.map((track) => {
              const patch = { ...edit }
              if (add.volume !== undefined) patch.volume = Math.max(-60, Math.min(12, track.volume + add.volume))
              if (add.pan !== undefined) patch.pan = Math.max(-1, Math.min(1, track.pan + add.pan))
              return [track.id, patch]
            }),
          )
          doc.updateTracks(patches)
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
        onApply={(edit, add) => doc.editBlocks(editing, edit, add)}
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
