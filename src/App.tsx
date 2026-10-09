// 画面の組み立て。上のバー、時間軸、選んだ波形ブロックの欄、ステータスバー、ダイアログ
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Box, Link, Snackbar } from '@mui/material'
import { AboutDialog, AppHeader, ContextMenu, FULL_HEIGHT, useConfirm, usePalette, LicensesDialog, StatusBar, StatusItem, StatusSpacer, useMobileLayout } from 'pevenmui'
import { UpdatePrompt } from 'pevenmui/pwa'
import { Minimap } from 'wevocal-lib/react'
import { AUDIO_ACCEPT, EXPORT_EXT, SELECTION_DARK, SELECTION_LIGHT, canRecord, downloadBlob, exportAudio, openInput, startRecording, type Range, type Recording } from 'wevocal-lib'
import { app } from './appConfig'
import { clearAutosave, loadAutosave, saveAutosave } from './storage/autosave'
import BlockDialog from './BlockDialog'
import MarkerDialog from './MarkerDialog'
import HistoryDialog from './HistoryDialog'
import EqDialog from './EqDialog'
import { flatEq } from 'wevocal-lib'
import type { TimelineView } from './drawTimeline'
import { analyzeTempo, pitchPending, preparePitch } from './dsp/pitch'
import { Player, renderMix } from './engine'
import { buildOverview } from './overview'
import ExportDialog, { type ExportChoice } from './ExportDialog'
import { useT } from './i18n'
import { setKeyOverrides } from './keymap'
import { PROJECT_EXT, readProject, writeProject } from './projectFile'
import type { Settings } from './settings'
import SettingsDialog from './SettingsDialog'
import AnalysisPanel from './AnalysisPanel'
import { snapGrid } from './grid'
import { newProject } from './project'
import Timeline, { HEADER } from './Timeline'
import Toolbar from './Toolbar'
import Transport from './Transport'
import { useActions } from './useActions'
import { useProject, type DropAt } from './useProject'

/** 今動いている版 */
const BUILD = `${__APP_VERSION__} (${__APP_COMMIT__})`

/** アプリのアイコン（public/icon.svg）。サブパスで配信されても読めるよう BASE_URL から組み立てる */
const AppIcon = ({ size }: { size: number }) => <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" width={size} height={size} style={{ display: 'block' }} />

const openExternal = (url: string) => window.open(url, '_blank', 'noopener,noreferrer')

export default function App(p: { settings: Settings; onSettingsChange: (patch: Partial<Settings>) => void }) {
  const t = useT()
  const { confirm, dialog: confirmDialog } = useConfirm()
  // キーの割り当ては設定から（描く前に入れる。メニューとツールチップの表記もこれを使う）
  setKeyOverrides(p.settings.keys)
  const mobile = useMobileLayout()
  const doc = useProject({ algorithm: p.settings.algorithm, preserveFormant: p.settings.preserveFormant })
  const { project } = doc
  const player = useRef(new Player())
  const [playing, setPlaying] = useState(false)
  // 編集カーソル（押した所、貼り付ける所。再生では動かない）と、再生カーソル（再生中と一時停止中だけ。REAPER と同じく 2 本）
  const [cursor, setCursor] = useState(0)
  const [playPos, setPlayPos] = useState<number | null>(null)
  // 一時停止した位置（編集カーソルを動かしたら消す）
  const [paused, setPaused] = useState<number | null>(null)
  // 再生中の位置は状態に入れず、描く所が毎フレーム読む（画面全体を毎フレーム描き直さないように。WeVocalSynth と同じ）
  const livePos = useCallback(() => (player.current.playing ? player.current.position() : playPos), [playPos])
  const [selected, setSelected] = useState<string[]>([])
  const [selectedTrack, setSelectedTrack] = useState<string | null>(null)
  const [range, setRange] = useState<Range | null>(null)
  const [repeat, setRepeat] = useState(false)
  // 録音中のものと、録り始めた位置
  const [recording, setRecording] = useState<{ rec: Recording; start: number; track: string } | null>(null)
  const [view, setView] = useState<TimelineView>({ scroll: 0, pps: 50 })
  const [timelineWidth, setTimelineWidth] = useState(0)
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null)
  // プロパティを開いている波形ブロック（複数なら一括で変える）
  const [editing, setEditing] = useState<string[]>([])
  const sourceInput = useRef<HTMLInputElement>(null)
  const [editingMarker, setEditingMarker] = useState<string | null>(null)
  const [eqTrack, setEqTrack] = useState<string | null>(null)
  const eqOf = project.tracks.find((tr) => tr.id === eqTrack)
  const [fileName, setFileName] = useState('untitled')
  const [busy, setBusy] = useState(false)
  const [pitching, setPitching] = useState(false)
  // ピッチや速度を変えた音ができるたびに増やす（解析の欄が作り直した音で解析し直す）
  const [madeVersion, setMadeVersion] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // 起動時の復元が終わるまでは自動保存しない（空のプロジェクトで前回の作業を上書きしないように）
  const [restored, setRestored] = useState(false)
  const [dialog, setDialog] = useState<'settings' | 'about' | 'licenses' | 'export' | 'history' | null>(null)
  const audioInput = useRef<HTMLInputElement>(null)
  const projectInput = useRef<HTMLInputElement>(null)
  const editingBlocks = project.blocks.filter((b) => editing.includes(b.id))
  const sourceOf = (id: string | undefined) => project.sources.find((s) => s.id === id)
  const { pal, dark } = usePalette()
  // ミニマップ（全体を縮めた波形。WeVocalSynth と同じ部品）
  // 作り直しは操作のあとに回す（ドラッグの途中で固まらないように）
  const deferredProject = useDeferredValue(project)
  const overview = useMemo(() => buildOverview(deferredProject), [deferredProject])
  const end = project.blocks.reduce((m, b) => Math.max(m, b.start + b.length), 0)

  const fail = (e: unknown) => setError(String(e))

  const play = () => {
    // 範囲選択があれば、その中だけを鳴らす（外にいたら範囲の頭から）
    // 一時停止していたらそこから。範囲選択があれば、その中だけを鳴らす（外にいたら範囲の頭から）
    const at = paused ?? cursor
    const from = range && (at < range.start || at >= range.end) ? range.start : at
    setPaused(null)
    setPlayPos(from)
    player.current.play(project, from)
    setPlaying(true)
  }
  /** 録音を始める（再生位置から、ほかのトラックを鳴らしながら録る。REAPER と同じ） */
  const startRecord = async () => {
    if (!canRecord()) return fail(t('error.noRecord'))
    try {
      // 録音待機のトラック、なければ選んでいるトラック、空いているトラック、新しいトラックの順に置く
      const track =
        project.tracks.find((tr) => tr.armed)?.id ??
        selectedTrack ??
        project.tracks.find((tr) => !project.blocks.some((b) => b.track === tr.id))?.id ??
        doc.addTrackNow()
      const rec = await startRecording(await openInput({ deviceId: p.settings.inputDevice, echoCancellation: false, noiseSuppression: false, autoGainControl: false }))
      setRecording({ rec, start: cursor, track })
      play()
    } catch (e) {
      fail(e)
    }
  }
  /** 録音を止めて、録った音を波形ブロックとして置く */
  const stopRecord = async () => {
    const r = recording
    if (!r) return
    setRecording(null)
    player.current.stop()
    setPlaying(false)
    try {
      const clip = await r.rec.stop()
      if (clip.channels[0]?.length) doc.addClip(clip, `${t('track.recorded')} ${new Date().toLocaleTimeString()}`, r.track, r.start)
    } catch (e) {
      fail(e)
    }
  }
  /** 選んだ波形ブロック（なければ最初のもの）からテンポを解析して、プロジェクトのテンポにする（WeVocalSynth と同じ解析） */
  const detectTempo = async () => {
    const b = project.blocks.find((x) => selected.includes(x.id)) ?? project.blocks[0]
    const source = b && sourceOf(b.source)
    if (!b || !source) return
    setBusy(true)
    try {
      const { clip } = source
      const from = Math.floor(b.offset * clip.sampleRate)
      const to = Math.min(clip.channels[0].length, from + Math.floor(b.length * b.rate * clip.sampleRate))
      const mono = new Float32Array(to - from)
      for (const ch of clip.channels) for (let i = 0; i < mono.length; i++) mono[i] += ch[from + i] / clip.channels.length
      const [best] = await analyzeTempo(mono, clip.sampleRate)
      if (!best) return fail(t('error.noTempo'))
      // 速度を変えた波形ブロックは、そのぶん BPM も変わる
      const bpm = Math.round(best.bpm * b.rate * 100) / 100
      const beat = 60 / bpm
      const first = b.start + best.offset / b.rate
      doc.updateTempo({ bpm, beatOffset: ((first % beat) + beat) % beat })
      setNotice(t('toast.tempo', { bpm }))
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  const toggleRecord = () => void (recording ? stopRecord() : startRecord())

  /** 一時停止。再生カーソルはその場に残す */
  const pause = () => {
    const pos = player.current.position()
    player.current.stop()
    setPaused(pos)
    setPlayPos(pos)
    setPlaying(false)
  }
  /** 停止。再生カーソルを消す（編集カーソルはそのまま。次の再生はそこから） */
  const stop = () => {
    if (recording) return void stopRecord()
    player.current.stop()
    setPlaying(false)
    setPaused(null)
    setPlayPos(null)
  }
  /** 編集カーソルだけを動かす（波形ブロックを押したとき、コピー、貼り付け） */
  const moveCursor = (time: number) => {
    setCursor(time)
    setPaused(null)
  }
  /** 編集カーソルを動かし、再生中なら再生もそこへ（目盛りと空いている所。REAPER の既定と同じ） */
  const seek = (time: number) => {
    moveCursor(time)
    if (playing) {
      player.current.play(project, time)
      setPlayPos(time)
    } else setPlayPos(null)
  }

  const load = (files: File[], at?: DropAt) => doc.addFiles(files, at).catch(fail)

  const openProject = async (file: File) => {
    try {
      stop()
      doc.replace(await readProject(file))
      setRange(null)
      setFileName(file.name.replace(/\.[^.]+$/, ''))
      setSelected([])
      setSelectedTrack(null)
      setCursor(0)
    } catch (e) {
      fail(e)
    }
  }

  const save = () => downloadBlob(writeProject(project), fileName + PROJECT_EXT)

  const runExport = async (c: ExportChoice) => {
    setBusy(true)
    try {
      const mix = await renderMix(project, c.rangeOnly && range ? range.end : 0)
      const blob = await exportAudio(mix, { ...c, sampleRate: mix.sampleRate, mono: false, range: c.rangeOnly ? range : null })
      downloadBlob(blob, fileName + EXPORT_EXT[c.format])
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  const { menus, blockMenu, commands } = useActions({
    doc,
    cursor,
    playing,
    selected,
    selectedTrack,
    range,
    setRange,
    select: setSelected,
    selectTrack: setSelectedTrack,
    play,
    stop,
    pause,
    repeat,
    recording: !!recording,
    detectTempo: () => void detectTempo(),
    toggleRecord,
    toggleRepeat: () => setRepeat((r) => !r),
    seek,
    moveCursor,
    gridStep: () => snapGrid(p.settings.grid, project.tempo, view.pps).step,
    newProject: () =>
      void confirm({ message: t('confirm.newProject'), okLabel: t('menu.newProject'), danger: true }).then((ok) => {
        if (!ok) return
        stop()
        doc.replace(newProject(), 'history.new')
        setFileName('untitled')
        setSelected([])
        setRange(null)
        setCursor(0)
      }),
    zoom: (f) => setView((v) => ({ ...v, pps: Math.min(2000, Math.max(2, v.pps * f)) })),
    // 選んでいるものの中を開いたら、選んでいるもの全部を一括で
    openProperties: (id: string) => setEditing(selected.includes(id) ? selected : [id]),
    openFile: () => projectInput.current?.click(),
    importFiles: () => audioInput.current?.click(),
    save,
    openExport: () => setDialog('export'),
    openSettings: () => setDialog('settings'),
    openHistory: () => setDialog('history'),
    snap: p.settings.snap,
    toggleSnap: () => p.onSettingsChange({ snap: !p.settings.snap }),
    follow: p.settings.follow,
    toggleFollow: () => p.onSettingsChange({ follow: !p.settings.follow }),
    beatGrid: p.settings.grid === 'beats',
    toggleGrid: () => p.onSettingsChange({ grid: p.settings.grid === 'beats' ? 'time' : 'beats' }),
    showAnalysis: p.settings.showAnalysis,
    toggleAnalysis: () => p.onSettingsChange({ showAnalysis: !p.settings.showAnalysis }),
    showMinimap: p.settings.showMinimap,
    toggleMinimap: () => p.onSettingsChange({ showMinimap: !p.settings.showMinimap }),
    showStatusBar: p.settings.showStatusBar,
    toggleStatusBar: () => p.onSettingsChange({ showStatusBar: !p.settings.showStatusBar }),
    help: { guide: () => openExternal(app.repository), licenses: () => setDialog('licenses'), about: () => setDialog('about') },
  })

  // 起動時に前回の作業を復元する（WeVocalSynth と同じ）
  useEffect(() => {
    if (!p.settings.autoRestore) return setRestored(true)
    loadAutosave()
      .then((r) => {
        if (!r) return
        doc.replace(r.project, 'history.restore')
        setFileName(r.fileName)
        setNotice(t('toast.restored'))
      })
      .catch(fail)
      .finally(() => setRestored(true))
    // 起動時に 1 回だけ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 変わったら少し待って書く。設定で切ったら消す
  useEffect(() => {
    if (!restored) return
    if (!p.settings.autoRestore) return void clearAutosave().catch(fail)
    const id = setTimeout(() => saveAutosave(project, fileName).catch(fail), 500)
    return () => clearTimeout(id)
  }, [project, fileName, restored, p.settings.autoRestore])

  // 再生中は位置を動かす
  useEffect(() => {
    if (!playing) return
    let id = 0
    const tick = () => {
      const pos = player.current.position()
      // 範囲の終わりで止める。リピートなら範囲の頭に戻る
      if (range && pos >= range.end) {
        if (repeat) {
          player.current.play(project, range.start)
          setPlayPos(range.start)
        } else {
          player.current.stop()
          setPlayPos(null)
          setPlaying(false)
          return
        }
      } else if (!range && end > 0 && pos >= end) {
        // 曲の終わり（最後の波形ブロックの終わり）で止める
        player.current.stop()
        setPlayPos(null)
        setPlaying(false)
        return
      }
      id = requestAnimationFrame(tick)
    }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
  }, [playing, range, repeat, project, end])

  // 再生中に変えた値を音に反映する（今の位置から組み直す）
  // 変わった波形ブロックだけを差し替える（全部を鳴らし直さない）
  const replay = () => player.current.update(project)
  // 続けて変えている間（ドラッグなど）は少し待ってから差し替える
  useEffect(() => {
    if (!player.current.playing) return
    const id = setTimeout(replay, 30)
    return () => clearTimeout(id)
    // project が変わったときだけ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project])

  // ピッチを変えた音を用意する。できたら鳴らし直す（できるまでは元の音で鳴らす）
  useEffect(() => {
    let alive = true
    setPitching(pitchPending(project))
    preparePitch(project, player.current.playing ? player.current.position() : cursor)
      .then((made) => {
        if (!alive || !made) return
        replay()
        setMadeVersion((v) => v + 1)
      })
      .catch((e: unknown) => alive && fail(e))
      .finally(() => alive && setPitching(false))
    return () => {
      alive = false
    }
  }, [project])

  return (
    <Box
      sx={{ height: FULL_HEIGHT, display: 'flex', flexDirection: 'column', overflow: 'hidden', bgcolor: 'background.default' }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        const files = [...e.dataTransfer.files]
        const proj = files.find((f) => f.name.endsWith(PROJECT_EXT))
        if (proj) void openProject(proj)
        else void load(files)
      }}
    >
      <AppHeader icon={<AppIcon size={16} />} menus={menus} />
      <Toolbar
        follow={p.settings.follow}
        snap={p.settings.snap}
        canCut={commands.cut.enabled !== false}
        canPaste={commands.paste.enabled !== false}
        onFollow={commands.follow.run}
        onSnap={commands.snap.run}
        onZoom={(f) => setView((v) => ({ ...v, pps: Math.min(2000, Math.max(2, v.pps * f)) }))}
        onCut={commands.cut.run}
        onCopy={commands.copy.run}
        onPaste={commands.paste.run}
      />
      <input ref={audioInput} type="file" accept={AUDIO_ACCEPT} multiple hidden onChange={(e) => void load([...(e.target.files ?? [])]).finally(() => (e.target.value = ''))} />
      <input
        ref={projectInput}
        type="file"
        accept={PROJECT_EXT}
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void openProject(file)
        }}
      />

      <Timeline
        project={project}
        cursor={cursor}
        livePos={livePos}
        follow={p.settings.follow}
        onCursor={moveCursor}
        selected={selected}
        onSelect={setSelected}
        selectedTrack={selectedTrack}
        onSelectTrack={setSelectedTrack}
        onSeek={seek}
        range={range}
        onRange={setRange}
        onMasterChange={doc.updateMaster}
        onTrackChange={doc.updateTrack}
        onEndMerge={doc.endMerge}
        onDropFiles={(files, at) => void load(files, at)}
        onBlockChange={doc.updateBlock}
        onBlocksChange={doc.updateBlocks}
        onBlockMenu={(_, x, y) => setMenuAt({ x, y })}
        onCopyBlocks={(blocks) => void doc.insertBlocks(blocks)}
        onMarkerEdit={setEditingMarker}
        onProperties={(id) => setEditing(selected.includes(id) ? selected : [id])}
        onEq={setEqTrack}
        onDuplicateTrack={doc.duplicateTrack}
        onRemoveTrack={(id) => {
          doc.removeTrack(id)
          setSelected([])
        }}
        view={view}
        snap={p.settings.snap}
        playing={playing}
        grid={p.settings.grid}
        onView={setView}
        onWidth={setTimelineWidth}
      />
      {p.settings.showAnalysis && (
        <AnalysisPanel
          block={project.blocks.find((b) => b.id === selected[0]) ?? null}
          source={sourceOf(project.blocks.find((b) => b.id === selected[0])?.source)}
          view={view}
          headerWidth={HEADER}
          version={madeVersion}
          onCurve={(curve, merge) => {
            const id = selected[0]
            if (id) doc.updateBlock(id, { curve }, merge)
          }}
          onEndMerge={doc.endMerge}
        />
      )}
      {p.settings.showMinimap && project.blocks.length > 0 && (
        // 高さは Minimap の分だけ（伸ばさない）
        <Box sx={{ flexShrink: 0, flexGrow: 0, borderTop: 1, borderColor: 'divider' }}>
        <Minimap
          clip={overview.clip}
          duration={overview.duration}
          colors={{ text: pal.text.primary, textSecondary: pal.text.secondary, divider: pal.divider, wave: pal.primary.main, selection: dark ? SELECTION_DARK : SELECTION_LIGHT }}
          view={{ start: view.scroll, dur: timelineWidth / view.pps }}
          selections={range ? [range] : []}
          scrollTo={(start) => setView((v) => ({ ...v, scroll: Math.max(0, start) }))}
          label={t('menu.minimap')}
          position={playPos ?? cursor}
          livePosition={() => livePos() ?? cursor}
          playing={playing}
          showPlayhead
        />
        </Box>
      )}
      <Transport
        playing={playing}
        cursor={playPos ?? cursor}
        livePos={livePos}
        end={end}
        range={range}
        repeat={repeat}
        recording={!!recording}
        onRecord={toggleRecord}
        tempo={project.tempo}
        onTempo={(patch) => doc.updateTempo(patch)}
        onToStart={() => seek(0)}
        onStop={stop}
        onPause={() => (playing ? pause() : play())}
        onRepeat={() => setRepeat((r) => !r)}
        onToEnd={() => seek(end)}
      />
      <ContextMenu position={menuAt} entries={blockMenu} onClose={() => setMenuAt(null)} />
      {eqOf && (
        <EqDialog
          open
          trackName={eqOf.name}
          eq={eqOf.eq ?? flatEq()}
          onChange={(eq) => doc.updateTrack(eqOf.id, { eq }, `eq:${eqOf.id}`)}
          onClose={() => {
            doc.endMerge()
            setEqTrack(null)
          }}
        />
      )}
      <HistoryDialog open={dialog === 'history'} steps={doc.steps} index={doc.stepIndex} onGoto={doc.goto} onClose={() => setDialog(null)} />
      <MarkerDialog
        marker={project.markers.find((m) => m.id === editingMarker) ?? null}
        onClose={() => setEditingMarker(null)}
        onRename={(name) => editingMarker && doc.updateMarker(editingMarker, { name })}
        onRemove={() => editingMarker && doc.removeMarker(editingMarker)}
      />
      <BlockDialog
        blocks={editingBlocks}
        sources={project.sources}
        onClose={() => setEditing([])}
        onApply={(edit) => doc.editBlocks(editing, edit)}
        onPickFile={() => sourceInput.current?.click()}
      />
      <input
        ref={sourceInput}
        type="file"
        accept={AUDIO_ACCEPT}
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) doc.replaceSource(editing, file).then(() => setEditing([]), fail)
        }}
      />

      {!mobile && p.settings.showStatusBar && (
        <StatusBar>
          <StatusItem>{recording ? t('status.recording') : busy ? t('status.exporting') : pitching ? t('status.pitch') : playing ? t('status.playing') : t('status.ready')}</StatusItem>
          <StatusSpacer />
          <StatusItem secondary>{BUILD}</StatusItem>
        </StatusBar>
      )}

      <Snackbar open={!!error} autoHideDuration={8000} onClose={() => setError(null)}>
        <Alert severity="error" onClose={() => setError(null)}>
          {t('error.failed', { error: error ?? '' })}
        </Alert>
      </Snackbar>
      {confirmDialog}
      <UpdatePrompt build={BUILD} />
      <Snackbar open={!!notice} autoHideDuration={4000} onClose={() => setNotice(null)}>
        <Alert severity="info" onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      </Snackbar>
      <ExportDialog hasRange={!!range} open={dialog === 'export'} onClose={() => setDialog(null)} onExport={(c) => void runExport(c)} />
      <SettingsDialog open={dialog === 'settings'} onClose={() => setDialog(null)} settings={p.settings} onChange={p.onSettingsChange} />
      <LicensesDialog
        open={dialog === 'licenses'}
        onClose={() => setDialog(null)}
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
        open={dialog === 'about'}
        onClose={() => setDialog(null)}
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
    </Box>
  )
}
