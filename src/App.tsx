// 画面の組み立て。上のバー、時間軸、選んだ波形ブロックの欄、ステータスバー、ダイアログ
import { useEffect, useRef, useState } from 'react'
import { Alert, Box, Link, Snackbar } from '@mui/material'
import { AboutDialog, AppHeader, ContextMenu, FULL_HEIGHT, LicensesDialog, StatusBar, StatusItem, StatusSpacer, useMobileLayout } from 'pevenmui'
import { UpdatePrompt } from 'pevenmui/pwa'
import { AUDIO_ACCEPT, EXPORT_EXT, downloadBlob, exportAudio, type Range } from 'wevocal-lib'
import { app } from './appConfig'
import { clearAutosave, loadAutosave, saveAutosave } from './autosave'
import BlockDialog from './BlockDialog'
import type { TimelineView } from './drawTimeline'
import { pitchPending, preparePitch } from './dsp/pitch'
import { Player, renderMix } from './engine'
import ExportDialog, { type ExportChoice } from './ExportDialog'
import { useT } from './i18n'
import { PROJECT_EXT, readProject, writeProject } from './projectFile'
import type { Settings } from './settings'
import SettingsDialog from './SettingsDialog'
import Timeline from './Timeline'
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
  const mobile = useMobileLayout()
  const doc = useProject({ algorithm: p.settings.algorithm, preserveFormant: p.settings.preserveFormant })
  const { project } = doc
  const player = useRef(new Player())
  const [playing, setPlaying] = useState(false)
  const [cursor, setCursor] = useState(0)
  const [selected, setSelected] = useState<string[]>([])
  const [selectedTrack, setSelectedTrack] = useState<string | null>(null)
  const [range, setRange] = useState<Range | null>(null)
  const [repeat, setRepeat] = useState(false)
  const [view, setView] = useState<TimelineView>({ scroll: 0, pps: 50 })
  // 再生を始めた位置（停止で戻る）
  const playFrom = useRef(0)
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [fileName, setFileName] = useState('untitled')
  const [busy, setBusy] = useState(false)
  const [pitching, setPitching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // 起動時の復元が終わるまでは自動保存しない（空のプロジェクトで前回の作業を上書きしないように）
  const [restored, setRestored] = useState(false)
  const [dialog, setDialog] = useState<'settings' | 'about' | 'licenses' | 'export' | null>(null)
  const audioInput = useRef<HTMLInputElement>(null)
  const projectInput = useRef<HTMLInputElement>(null)
  const editingBlock = project.blocks.find((b) => b.id === editing) ?? null
  const sourceOf = (id: string | undefined) => project.sources.find((s) => s.id === id)
  const end = project.blocks.reduce((m, b) => Math.max(m, b.start + b.length), 0)

  const fail = (e: unknown) => setError(String(e))

  const play = () => {
    // 範囲選択があれば、その中だけを鳴らす（外にいたら範囲の頭から）
    const from = range && (cursor < range.start || cursor >= range.end) ? range.start : cursor
    setCursor(from)
    playFrom.current = from
    player.current.play(project, from)
    setPlaying(true)
  }
  const pause = () => {
    setCursor(player.current.position())
    player.current.stop()
    setPlaying(false)
  }
  const stop = () => {
    if (playing) setCursor(playFrom.current)
    player.current.stop()
    setPlaying(false)
  }
  const seek = (time: number) => {
    setCursor(time)
    if (playing) player.current.play(project, time)
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

  const { menus, blockMenu } = useActions({
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
    toggleRepeat: () => setRepeat((r) => !r),
    seek,
    zoom: (f) => setView((v) => ({ ...v, pps: Math.min(2000, Math.max(2, v.pps * f)) })),
    openProperties: setEditing,
    openFile: () => projectInput.current?.click(),
    importFiles: () => audioInput.current?.click(),
    save,
    openExport: () => setDialog('export'),
    openSettings: () => setDialog('settings'),
    snap: p.settings.snap,
    toggleSnap: () => p.onSettingsChange({ snap: !p.settings.snap }),
    beatGrid: p.settings.grid === 'beats',
    toggleGrid: () => p.onSettingsChange({ grid: p.settings.grid === 'beats' ? 'time' : 'beats' }),
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
        doc.replace(r.project)
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
          setCursor(range.start)
        } else {
          player.current.stop()
          setCursor(range.end)
          setPlaying(false)
          return
        }
      } else setCursor(pos)
      id = requestAnimationFrame(tick)
    }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
  }, [playing, range, repeat, project])

  // 再生中に変えた値を音に反映する（今の位置から組み直す）
  const replay = () => {
    if (player.current.playing) player.current.play(project, player.current.position())
  }
  useEffect(replay, [project])

  // ピッチを変えた音を用意する。できたら鳴らし直す（できるまでは元の音で鳴らす）
  useEffect(() => {
    let alive = true
    setPitching(pitchPending(project))
    preparePitch(project)
      .then((made) => alive && made && replay())
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
        view={view}
        snap={p.settings.snap}
        grid={p.settings.grid}
        onView={setView}
      />
      <Transport
        playing={playing}
        cursor={cursor}
        end={end}
        range={range}
        repeat={repeat}
        tempo={project.tempo}
        onTempo={(patch) => doc.updateTempo(patch)}
        onToStart={() => seek(0)}
        onStop={stop}
        onPlay={play}
        onPause={() => (playing ? pause() : play())}
        onRepeat={() => setRepeat((r) => !r)}
        onToEnd={() => seek(end)}
      />
      <ContextMenu position={menuAt} entries={blockMenu} onClose={() => setMenuAt(null)} />
      <BlockDialog
        block={editingBlock}
        name={sourceOf(editingBlock?.source)?.name ?? ''}
        duration={sourceOf(editingBlock?.source)?.duration ?? 0}
        onClose={() => setEditing(null)}
        onApply={(b) => editingBlock && doc.updateBlock(editingBlock.id, b)}
      />

      {!mobile && p.settings.showStatusBar && (
        <StatusBar>
          <StatusItem>{busy ? t('status.exporting') : pitching ? t('status.pitch') : playing ? t('status.playing') : t('status.ready')}</StatusItem>
          <StatusSpacer />
          <StatusItem secondary>{BUILD}</StatusItem>
        </StatusBar>
      )}

      <Snackbar open={!!error} autoHideDuration={8000} onClose={() => setError(null)}>
        <Alert severity="error" onClose={() => setError(null)}>
          {t('error.failed', { error: error ?? '' })}
        </Alert>
      </Snackbar>
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
