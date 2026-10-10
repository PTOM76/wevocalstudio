// 画面の組み立て。上のバー、時間軸、選んだ波形ブロックの欄、ステータスバー、ダイアログ
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Box, Link, Snackbar } from '@mui/material'
import { AboutDialog, ContextMenu, FULL_HEIGHT, LicensesDialog, WindowModeContext, autoWindowMode, startJob, useConfirm, useMobileLayout, usePalette } from 'pevenmui'
import StatusBar from './StatusBar'
import AppHeader, { AppIcon } from './AppHeader'
import { UpdatePrompt } from 'pevenmui/pwa'
import { Minimap } from 'wevocal-lib/react'
import { AUDIO_ACCEPT, SELECTION_DARK, SELECTION_LIGHT, canRecord, openInput, startRecording, type Range, type Recording } from 'wevocal-lib'
import { app } from './appConfig'
import { clearAutosave, loadAutosave, saveAutosave } from './storage/autosave'
import BlockDialog from './BlockDialog'
import MarkerDialog from './MarkerDialog'
import HistoryDialog from './HistoryDialog'
import EqDialog from './EqDialog'
import { flatEq } from 'wevocal-lib'
import type { TimelineView } from './drawTimeline'
import { analyzeTempo, onPitchProgress, pitchProgress, preparePitch } from './dsp/pitch'
import { Player } from './engine'
import { buildOverview } from './overview'
import ExportDialog from './ExportDialog'
import { useT } from './i18n'
import { setKeyOverrides } from './keymap'
import type { Settings } from './settings'
import SettingsDialog from './SettingsDialog'
import AnalysisPanel from './AnalysisPanel'
import LevelMeter from './LevelMeter'
import { snapGrid } from './grid'
import { newProject, visibleTracks, type Track } from './project'
import Timeline, { HEADER } from './Timeline'
import Toolbar from './Toolbar'
import Transport from './Transport'
import { useActions } from './useActions'
import { useProject, type DropAt } from './useProject'
import { useProjectFile } from './useProjectFile'

/** 今動いている版 */
const BUILD = `${__APP_VERSION__} (${__APP_COMMIT__})`

const openExternal = (url: string) => window.open(url, '_blank', 'noopener,noreferrer')

export default function App(p: { settings: Settings; onSettingsChange: (patch: Partial<Settings>) => void }) {
  const t = useT()
  const { confirm, dialog: confirmDialog } = useConfirm()
  // キーの割り当ては設定から（描く前に入れる。メニューとツールチップの表記もこれを使う）
  setKeyOverrides(p.settings.keys)
  const mobile = useMobileLayout()
  const doc = useProject({ algorithm: p.settings.algorithm, preserveFormant: p.settings.preserveFormant })
  const { project, selected } = doc
  const setSelected = doc.select
  const player = useRef(new Player())
  const [playing, setPlaying] = useState(false)
  // 編集カーソル（押した所、貼り付ける所。再生では動かない）と、再生カーソル（再生中と一時停止中だけ。REAPER と同じく 2 本）
  const [cursor, setCursor] = useState(0)
  const [playPos, setPlayPos] = useState<number | null>(null)
  // 一時停止した位置（編集カーソルを動かしたら消す）
  const [paused, setPaused] = useState<number | null>(null)
  // 再生中の位置は状態に入れず、描く所が毎フレーム読む（画面全体を毎フレーム描き直さないように。WeVocalSynth と同じ）
  const livePos = useCallback(() => (player.current.playing ? player.current.position() : playPos), [playPos])
  // 選んでいるトラック（複数。最後に選んだものが「選んでいるトラック」で、貼り付けや録音の先）
  const [selectedTracks, setSelectedTracks] = useState<string[]>([])
  const selectedTrack = selectedTracks[selectedTracks.length - 1] ?? null
  const setSelectedTrack = (id: string | null) => setSelectedTracks(id ? [id] : [])
  const [range, setRange] = useState<Range | null>(null)
  const [repeat, setRepeat] = useState(false)
  // 録音中のものと、録り始めた位置
  const [recording, setRecording] = useState<{ rec: Recording; start: number; track: string } | null>(null)
  const [view, setView] = useState<TimelineView>({ scroll: 0, pps: 50 })
  const [timelineWidth, setTimelineWidth] = useState(0)
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null)
  // 何もない所の右クリックのメニュー（押した所の時刻とトラック）
  const [emptyAt, setEmptyAt] = useState<{ kind: 'lane' | 'ruler'; time: number; track: string | null; x: number; y: number } | null>(null)
  // 「ここに読み込む」の行き先（ファイルを選んだら使う）
  const importTarget = useRef<DropAt | undefined>(undefined)
  // プロパティを開いている波形ブロック（複数なら一括で変える）
  const [editing, setEditing] = useState<string[]>([])
  const sourceInput = useRef<HTMLInputElement>(null)
  const [editingMarker, setEditingMarker] = useState<string | null>(null)
  const [eqTrack, setEqTrack] = useState<string | null>(null)
  const eqOf = project.tracks.find((tr) => tr.id === eqTrack)
  const [fileName, setFileName] = useState('untitled')
  // ピッチや速度を変えた音ができるたびに増やす（解析の欄が作り直した音で解析し直す）
  const [madeVersion, setMadeVersion] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // 起動時の復元が終わるまでは自動保存しない（空のプロジェクトで前回の作業を上書きしないように）
  const [restored, setRestored] = useState(false)
  const [dialog, setDialog] = useState<'settings' | 'about' | 'licenses' | 'export' | 'history' | null>(null)
  const audioInput = useRef<HTMLInputElement>(null)
  // 時間軸に出すのは見えているトラックだけ（たたんだ親の子孫は隠す）
  const shown = useMemo(() => ({ ...project, tracks: visibleTracks(project) }), [project])
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

  const files = useProjectFile({
    t,
    settings: p.settings,
    project,
    fileName,
    range,
    onOpened: (proj, name) => {
      stop()
      doc.replace(proj)
      setRange(null)
      setFileName(name)
      setSelected([])
      setSelectedTrack(null)
      setCursor(0)
    },
    onAudio: (list) => void load(list),
    confirmDiscard: () => confirm({ message: t('confirm.discard'), okLabel: t('confirm.discardOk'), danger: true }),
    fail,
    notify: setNotice,
  })


  const { menus, blockMenu, emptyMenu, commands } = useActions({
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
    gridStep: () => snapGrid(p.settings.grid, project.tempo, view.pps, p.settings.gridDivision, project.markers, cursor).step,
    newProject: () =>
      // 保存していない変更があるときだけ確かめる
      void (files.dirty ? confirm({ message: t('confirm.newProject'), okLabel: t('menu.newProject'), danger: true }) : Promise.resolve(true)).then((ok) => {
        if (!ok) return
        stop()
        const fresh = newProject()
        doc.replace(fresh, 'history.new')
        files.markSaved(fresh)
        setFileName('untitled')
        setSelected([])
        setRange(null)
        setCursor(0)
      }),
    zoom: (f) => setView((v) => ({ ...v, pps: Math.min(2000, Math.max(2, v.pps * f)) })),
    // 選んでいるものの中を開いたら、選んでいるもの全部を一括で
    openProperties: (id: string) => setEditing(selected.includes(id) ? selected : [id]),
    openFile: files.picker.open,
    importFiles: () => {
      importTarget.current = undefined
      audioInput.current?.click()
    },
    importAt: (time, track) => {
      importTarget.current = track ? { track, start: time } : undefined
      audioInput.current?.click()
    },
    save: files.save,
    saveAs: files.saveAs,
    recent: files.recent,
    openExport: () => setDialog('export'),
    openSettings: () => setDialog('settings'),
    openHistory: () => setDialog('history'),
    snap: p.settings.snap,
    toggleSnap: () => p.onSettingsChange({ snap: !p.settings.snap }),
    follow: p.settings.follow,
    envelope: p.settings.envelope,
    toggleEnvelope: () => p.onSettingsChange({ envelope: !p.settings.envelope }),
    toggleFollow: () => p.onSettingsChange({ follow: !p.settings.follow }),
    beatGrid: p.settings.grid === 'beats',
    toggleGrid: () => p.onSettingsChange({ grid: p.settings.grid === 'beats' ? 'time' : 'beats' }),
    showAnalysis: p.settings.showAnalysis,
    toggleAnalysis: () => p.onSettingsChange({ showAnalysis: !p.settings.showAnalysis }),
    showMeters: p.settings.showMeters,
    toggleMeters: () => p.onSettingsChange({ showMeters: !p.settings.showMeters }),
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

  // かたまりが 1 つできるたびに、ゲージを動かし、再生中ならその波形ブロックを差し替え、時間軸の「処理中」を描き直す（まとめて 0.1 秒に 1 回）
  const projectRef = useRef(project)
  projectRef.current = project
  useEffect(() => {
    let timer = 0
    let lastDone = 0
    let pitchJob: ReturnType<typeof startJob> | null = null
    return onPitchProgress(() => {
      if (timer) return
      timer = window.setTimeout(() => {
        timer = 0
        const pr = pitchProgress()
        // ピッチなどを作っている間はゲージに出す
        if (pr.total > 0) {
          pitchJob ??= startJob('pitch', t('job.pitch'))
          pitchJob.update(pr.done / pr.total)
        } else {
          pitchJob?.end()
          pitchJob = null
        }
        // できたかたまりが増えていれば鳴らす音を差し替える
        const whole = Math.floor(pr.done)
        if (whole !== lastDone) {
          lastDone = whole
          player.current.update(projectRef.current)
          setMadeVersion((v) => v + 1)
        }
      }, 100)
    })
  }, [])

  // ピッチを変えた音を用意する（再生位置か編集カーソルに近い所から。できたかたまりから鳴らす）
  useEffect(() => {
    let alive = true
    preparePitch(project, player.current.playing ? player.current.position() : cursor)
      .then((made) => {
        if (!alive || !made) return
        replay()
        setMadeVersion((v) => v + 1)
      })
      .catch((e: unknown) => alive && fail(e))
    return () => {
      alive = false
    }
  }, [project])

  return (
    // 設定などのダイアログを、PC では別のウィンドウに出す（WeVocalSynth と同じ）
    <WindowModeContext.Provider value={autoWindowMode()}>
    <Box
      sx={{ height: FULL_HEIGHT, display: 'flex', flexDirection: 'column', overflow: 'hidden', bgcolor: 'background.default' }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        files.openFiles([...e.dataTransfer.files])
      }}
    >
      <AppHeader menus={menus} canUndo={doc.canUndo} canRedo={doc.canRedo} onUndo={doc.undo} onRedo={doc.redo} projectName={fileName} dirty={files.dirty} />
      <Toolbar
        follow={p.settings.follow}
        snap={p.settings.snap}
        envelope={p.settings.envelope}
        onEnvelope={commands.envelope.run}
        canCut={commands.cut.enabled !== false}
        canPaste={commands.paste.enabled !== false}
        onFollow={commands.follow.run}
        onSnap={commands.snap.run}
        onZoom={(f) => setView((v) => ({ ...v, pps: Math.min(2000, Math.max(2, v.pps * f)) }))}
        onCut={commands.cut.run}
        onCopy={commands.copy.run}
        onPaste={commands.paste.run}
      />
      <input ref={audioInput} type="file" accept={AUDIO_ACCEPT} multiple hidden onChange={(e) => void load([...(e.target.files ?? [])], importTarget.current).finally(() => (e.target.value = ''))} />
      {files.picker.input}

      <Timeline
        project={shown}
        tree={project}
        onTrackOp={(op, id) => {
          if (op === 'addSubtrack') setSelectedTrack(doc.addSubtrack(id))
          else if (op === 'indent') doc.indentTrack(id)
          else doc.outdentTrack(id)
        }}
        cursor={cursor}
        livePos={livePos}
        follow={p.settings.follow}
        onCursor={moveCursor}
        selected={selected}
        onSelect={setSelected}
        selectedTrack={selectedTrack}
        onSelectTrack={setSelectedTrack}
        selectedTracks={selectedTracks}
        onSelectTracks={setSelectedTracks}
        onSeek={seek}
        range={range}
        onRange={setRange}
        onMasterChange={doc.updateMaster}
        onTrackChange={(id, patch, merge) => {
          // 選んでいるトラックの一つを変えたら、選んだもの全部に同じだけ掛ける（音量とパンは差分で。REAPER と同じ）
          if (selectedTracks.length < 2 || !selectedTracks.includes(id) || 'name' in patch || 'eq' in patch) return doc.updateTrack(id, patch, merge)
          const base = project.tracks.find((tr) => tr.id === id)!
          doc.updateTracks(
            Object.fromEntries(
              project.tracks
                .filter((tr) => selectedTracks.includes(tr.id))
                .map((tr) => {
                  const q: Partial<Track> = { ...patch }
                  if (patch.volume !== undefined) q.volume = Math.max(-60, Math.min(12, tr.volume + patch.volume - base.volume))
                  if (patch.pan !== undefined) q.pan = Math.max(-1, Math.min(1, tr.pan + patch.pan - base.pan))
                  return [tr.id, q]
                }),
            ),
            merge,
          )
        }}
        onEndMerge={doc.endMerge}
        onDropFiles={(files, at) => void load(files, at)}
        onBlockChange={doc.updateBlock}
        onBlocksChange={doc.updateBlocks}
        onBlockMenu={(_, x, y) => setMenuAt({ x, y })}
        onEmptyMenu={(kind, time, track, x, y) => setEmptyAt({ kind, time, track, x, y })}
        onCopyBlocks={(blocks) => void doc.insertBlocks(blocks)}
        onMarkerEdit={setEditingMarker}
        onProperties={(id) => setEditing(selected.includes(id) ? selected : [id])}
        onEq={setEqTrack}
        meter={p.settings.showMeters ? player.current.meter : undefined}
        masterMeter={p.settings.showMeters ? player.current.masterMeters : undefined}
        onDuplicateTrack={doc.duplicateTrack}
        onRemoveTrack={(id) => {
          doc.removeTrack(id)
          setSelected([])
        }}
        view={view}
        snap={p.settings.snap}
        playing={playing}
        grid={p.settings.grid}
        division={p.settings.gridDivision}
        envelope={p.settings.envelope}
        onView={setView}
        onWidth={setTimelineWidth}
        madeVersion={madeVersion}
        pendingLabel={t('status.pitchBlock')}
      />
      {p.settings.showAnalysis && (
        <AnalysisPanel
          block={project.blocks.find((b) => b.id === selected[0]) ?? null}
          source={sourceOf(project.blocks.find((b) => b.id === selected[0])?.source)}
          view={view}
          headerWidth={HEADER}
          version={madeVersion}
          range={range}
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
        meter={p.settings.showMeters ? <LevelMeter source={player.current.masterMeters} rows={2} width={96} height={7} label={t('meter.master')} /> : null}
        end={end}
        range={range}
        repeat={repeat}
        recording={!!recording}
        onRecord={toggleRecord}
        tempo={project.tempo}
        onTempo={(patch) => doc.updateTempo(patch)}
        division={p.settings.gridDivision}
        onDivision={(gridDivision) => p.onSettingsChange({ gridDivision })}
        onToStart={() => seek(0)}
        onStop={stop}
        onPause={() => (playing ? pause() : play())}
        onRepeat={() => setRepeat((r) => !r)}
        onToEnd={() => seek(end)}
      />
      <ContextMenu position={menuAt} entries={blockMenu} onClose={() => setMenuAt(null)} />
      <ContextMenu position={emptyAt} entries={emptyAt ? emptyMenu(emptyAt.kind, emptyAt.time, emptyAt.track) : []} onClose={() => setEmptyAt(null)} />
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
        bpm={project.tempo.bpm}
        beatsPerBar={project.tempo.beatsPerBar}
        onChange={(patch) => editingMarker && doc.updateMarker(editingMarker, patch)}
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
        <StatusBar
          fileName={fileName}
          dirty={files.dirty}
          onRename={setFileName}
          sampleRate={48000}
          tracks={project.tracks.length}
          range={range}
          onRange={setRange}
          bpm={project.tempo.bpm}
        />
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
      <ExportDialog hasRange={!!range} open={dialog === 'export'} onClose={() => setDialog(null)} onExport={files.runExport} />
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
    </WindowModeContext.Provider>
  )
}
