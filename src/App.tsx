// 画面の組み立て。上のバー、時間軸、選んだ波形ブロックの欄、ステータスバー、ダイアログ
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { Box } from '@mui/material'
import { DockArea, EmptyState, NoticeMessage, editBarEnabled, useAddonInstall, ContextMenu, SliderResetContext, TempoField, FULL_HEIGHT, WindowModeContext, autoWindowMode, useConfirm, useMobileLayout, usePalette, startJob } from 'pevenmui'
import StatusBar from './StatusBar'
import { useAddonFolder } from './useAddonFolder'
import AppHeader from './AppHeader'
import { DebugOverlay, reportAudioContext, countRender } from 'pevenmui/debug'
import { isMobile, openNewWindow, openWindowCount, slot } from 'pevenmui/web'
import { configurePlayback, setOutputDevice, setOutputLimit } from 'wevocal-lib'
import { UpdatePrompt, checkForUpdate, promptUpdate } from 'pevenmui/pwa'
import { Minimap } from 'wevocal-lib/react'
import { faFolderOpen, faMicrophone, faWaveSquare } from '@fortawesome/free-solid-svg-icons'
import { AUDIO_ACCEPT, canRecord, downloadBlob, readWvsp, SELECTION_DARK, SELECTION_LIGHT } from 'wevocal-lib'
import { app } from './appConfig'
import AppDialogs from './AppDialogs'
import { DocContext } from './DocContext'
import { useDialogs } from './useDialogs'
import type { TimelineView } from './drawTimeline'
import { Player } from './engine'
import { buildOverview } from './overview'
import { useT } from './i18n'
import { setKeyOverrides } from './keymap'
import type { Settings } from './settings/settings'
import AnalysisPanel from './AnalysisPanel'
import LevelMeter from './LevelMeter'
import { snapGrid } from './grid'
import { buildMidi } from './midiExport'
import { emitNote } from './pianoRoll/noteBus'
import { readMidi } from './midiImport'
import { addWvspTracks, midiBlocks, newProject, songEnd, trackHeight, TRACK_HEIGHT_MAX, TRACK_HEIGHT_MIN, visibleTracks, type Track } from './project'
import Timeline, { useHeaderWidth } from './Timeline'
import Toolbar from './Toolbar'
import Transport from './Transport'
import { useActions } from './useActions'
import { useProject, type DropAt } from './useProject'
import { isProjectLike, useProjectFile } from './useProjectFile'
import { useTempoDetect } from './useTempoDetect'
import { useExtract } from './useExtract'
import BlockEditBar from './BlockEditBar'
import { CONVERTER_ADDON } from 'wevocalconverter/host'
import { applyBaked, bakeBlocks } from './bake'
import { freezeTrack, unfreezeTrack } from './freeze'
import { useMidiInput } from './useMidiInput'
import { useRecorder } from './useRecorder'
import { useAutosave } from './useAutosave'
import { usePlayerSync } from './usePlayerSync'

/** 今動いている版 */
const BUILD = `${__APP_VERSION__} (${__APP_COMMIT__})`

const openExternal = (url: string) => window.open(url, '_blank', 'noopener,noreferrer')

// デバッグ表示に AudioContext の状態を出す（iPhone で音が出ないときの調査。WeVocalSynth と同じ）
configurePlayback({ report: reportAudioContext })

/** タッチの操作の案内を出したか（一度だけ） */
const TOUCH_HINT_KEY = 'studio.touchHint'

export default function App(p: { settings: Settings; onSettingsChange: (patch: Partial<Settings>) => void }) {
  countRender('App')
  const t = useT()
  const { confirm, dialog: confirmDialog } = useConfirm()
  // キーの割り当ては設定から（描く前に入れる。メニューとツールチップの表記もこれを使う）
  setKeyOverrides(p.settings.keymap, p.settings.ctrlS)
  const mobile = useMobileLayout()
  const { width: header, bar: headerBar, collapsed: headerCollapsed, toggle: toggleHeader } = useHeaderWidth()
  // 出力先とリミッター（wevocal-lib。WeVocalSynth と同じ）
  const { suspendWhenStopped, playbackSession } = p.settings
  useEffect(() => void configurePlayback({ suspendWhenStopped, playbackSession, report: reportAudioContext }), [suspendWhenStopped, playbackSession])
  useEffect(() => setOutputDevice(p.settings.outputDevice), [p.settings.outputDevice])
  useEffect(() => setOutputLimit(p.settings.outputLimit ? p.settings.outputLimitDb : null), [p.settings.outputLimit, p.settings.outputLimitDb])
  const addonFolderNotice = useAddonFolder(p.settings.addonFolder)
  // Ctrl+Shift+D でデバッグ表示を切り替える（WeVocalSynth と同じ）
  const settingsRef = useRef(p.settings)
  settingsRef.current = p.settings
  const { onSettingsChange } = p
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'KeyD') {
        e.preventDefault()
        onSettingsChange({ showDebug: !settingsRef.current.showDebug })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onSettingsChange])
  const doc = useProject({ algorithm: p.settings.algorithm, preserveFormant: p.settings.preserveFormant, historyLimit: p.settings.historyLimit, defaultFade: p.settings.defaultBlockFade ? p.settings.defaultBlockFadeMs / 1000 : 0, defaultBpm: p.settings.defaultBpm })
  const { project, selected } = doc
  const setSelected = doc.select
  const player = useRef(new Player())
  // 音を作る処理の負荷（FX のダイアログに出す）
  const [renderLoad, setRenderLoad] = useState<number | null>(null)
  useEffect(() => {
    player.current.onLoad = setRenderLoad
    // プラグインが保存したい状態を、FX の項目に入れる（操作ではないので履歴には積まない）
    player.current.onFxState = doc.setFxState
  }, [doc.setFxState])
  // 重いプラグインを先に計算して鳴らすか（設定）
  player.current.anticipative = p.settings.anticipativeFx
  player.current.chunkCacheMb = p.settings.anticipativeCacheMb
  player.current.offsetMs = p.settings.playbackOffsetMs
  const [playing, setPlaying] = useState(false)
  // 編集カーソル（押した所、貼り付ける所。再生では動かない）と、再生カーソル（再生中と一時停止中だけ。 2 本）
  const [cursor, setCursor] = useState(0)
  const [playPos, setPlayPos] = useState<number | null>(null)
  // 一時停止した位置（編集カーソルを動かしたら消す）
  const [paused, setPaused] = useState<number | null>(null)
  // 止めている間に、鳴らし始める位置から先の FX の音を先に作っておく（最後の操作から少し待つ。memo/fx-cache.md）
  useEffect(() => {
    if (playing) return
    const h = setTimeout(() => void player.current.warm(project, paused ?? cursor), 1500)
    return () => clearTimeout(h)
  }, [project, cursor, paused, playing, p.settings.anticipativeFx])
  // 再生中の位置は状態に入れず、描く所が毎フレーム読む（画面全体を毎フレーム描き直さないように。WeVocalSynth と同じ）
  const livePos = useCallback(() => (player.current.playing ? player.current.position() : playPos), [playPos])
  // 選んでいるトラック（複数。最後に選んだものが「選んでいるトラック」で、貼り付けや録音の先）
  const { selectedTracks, selectTracks: setSelectedTracks, range, setRange } = doc
  const [selectMode, setSelectMode] = useState(false)
  const selectedTrack = selectedTracks[selectedTracks.length - 1] ?? null
  const setSelectedTrack = (id: string | null) => setSelectedTracks(id ? [id] : [])
  const [repeat, setRepeat] = useState(false)
  const [view, setView] = useState<TimelineView>({ scroll: 0, pps: 50 })
  const [timelineWidth, setTimelineWidth] = useState(0)
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null)
  // 何もない所の右クリックのメニュー（押した所の時刻とトラック）
  // エンベロープの道具（ペンなら、波形ブロックのどこを押しても点を足す。既定は選択で、線と点だけを触る）と、線や点の右クリックのメニュー
  const [envPen, setEnvPen] = useState(false)
  const [envAt, setEnvAt] = useState<{ block: string; index: number; x: number; y: number } | null>(null)
  const envKind = p.settings.envelope ? 'volume' : p.settings.pitchEnvelope ? 'pitch' : null
  const [emptyAt, setEmptyAt] = useState<{ kind: 'lane' | 'ruler'; time: number; track: string | null; x: number; y: number; marker?: string } | null>(null)
  // 「ここに読み込む」の行き先（ファイルを選んだら使う）
  const importTarget = useRef<DropAt | undefined>(undefined)
  // プロパティを開いている波形ブロック（複数なら一括で変える）
  const [fileName, setFileName] = useState('untitled')
  // ピッチや速度を変えた音ができるたびに増やす（解析の欄が作り直した音で解析し直す）
  const [madeVersion, setMadeVersion] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // 起動時の復元が終わるまでは自動保存しない（空のプロジェクトで前回の作業を上書きしないように）
  const [restored, setRestored] = useState(false)
  // ダイアログの開閉（PevenMUI の useDialogs。WeVocalSynth と同じ）。描画は AppDialogs.tsx
  const dialogs = useDialogs()
  const audioInput = useRef<HTMLInputElement>(null)
  // 時間軸に出すのは見えているトラックだけ（たたんだ親の子孫は隠す）
  const shown = useMemo(() => ({ ...project, tracks: visibleTracks(project) }), [project])
  const moveVisibleTrack = (id: string, visibleTo: number) => {
    const visible = shown.tracks
    const before = visible[visibleTo]
    const fullTo = before ? project.tracks.findIndex((tr) => tr.id === before.id) : project.tracks.length
    doc.reorderTrack(id, fullTo)
  }
  const sourceOf = (id: string | undefined) => project.sources.find((s) => s.id === id)
  const { pal, dark } = usePalette()
  // ミニマップ（全体を縮めた波形。WeVocalSynth と同じ部品）
  // 作り直しは操作のあとに回す（ドラッグの途中で固まらないように）
  const deferredProject = useDeferredValue(project)
  // 出していないときは作らない（全ブロックを走査するため）
  const overview = useMemo(() => (p.settings.showMinimap ? buildOverview(deferredProject) : null), [deferredProject, p.settings.showMinimap])
  const end = songEnd(project)

  const fail = (e: unknown) => setError(String(e))

  const play = () => {
    // 範囲選択があれば、その中だけを鳴らす（外にいたら範囲の頭から）
    // 一時停止していたらそこから。範囲選択があれば、その中だけを鳴らす（外にいたら範囲の頭から）
    const at = paused ?? cursor
    const from = range && (at < range.start || at >= range.end) ? range.start : at
    setPaused(null)
    setPlayPos(from)
    void player.current.play(project, from).then(() => player.current.playing && setPlaying(true)).catch(fail)
  }
  /** start〜end 秒だけを再生する（ピアノロールの再生）。範囲として選び、loop なら繰り返す */
  const playRange = (start: number, end: number, loop: boolean, from = start) => {
    setRange({ start, end })
    setRepeat(loop)
    setPaused(null)
    setPlayPos(from)
    void player.current.play(project, from).then(() => player.current.playing && setPlaying(true)).catch(fail)
  }
  /**
   * ピアノロールの再生。メインの再生と同じく、範囲選択か編集位置がそのブロックの中にあれば、そこから鳴らす（範囲があれば範囲の中だけ）。
   * なければ、ブロックの範囲を鳴らす。loop なら繰り返す
   */
  const playRoll = (start: number, end: number, loop: boolean) => {
    const inRange = !!range && range.end > start && range.start < end
    if (!inRange && !(cursor >= start && cursor < end)) return playRange(start, end, loop)
    // 編集位置から繰り返すときは、ブロックの範囲を選んで（終わりで折り返すため）編集位置から鳴らす
    if (loop && !inRange) return playRange(start, end, true, cursor)
    setRepeat(loop)
    play()
  }
  // 追加機能の導入の確かめ（動画の書き出し。PevenMUI）
  const addonInstall = useAddonInstall()
  // ボーカル抽出と楽器ごとの分離（extractor の host.ts。WeVocalSynth と共通）
  /** 選んだ波形ブロックを確定する（今の音にして、元の音を置き換える） */
  const bake = async (ids: string[]) => {
    const controller = new AbortController()
    const job = startJob('bake', t('bake.job'), () => controller.abort())
    try {
      const baked = await bakeBlocks(doc.project, ids, (v) => job.update(v), 'all', controller.signal)
      doc.apply((pr) => applyBaked(pr, baked))
      setNotice(t('toast.baked'))
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) fail(e)
    } finally {
      job.end()
    }
  }
  /** トラックのフリーズと解除（src/freeze.ts） */
  const freeze = async (id: string, withFx = false) => {
    if (project.tracks.find((tr) => tr.id === id)?.frozen) return doc.apply((pr) => unfreezeTrack(pr, id))
    const controller = new AbortController()
    const job = startJob('freeze', t('freeze.job'), () => controller.abort())
    try {
      const frozen = await freezeTrack(doc.project, id, withFx, controller.signal)
      const f = frozen.tracks.find((tr) => tr.id === id)?.frozen
      const src = f && frozen.sources.find((s) => s.id === f.source)
      // 描画している間の変更は残し、書き出した音とトラックの印だけを足す
      if (f && src) doc.apply((pr) => (pr.tracks.some((tr) => tr.id === id) ? { ...pr, sources: [...pr.sources, src], tracks: pr.tracks.map((tr) => (tr.id === id ? { ...tr, frozen: f } : tr)) } : pr))
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) fail(e)
    } finally {
      job.end()
    }
  }
  const extract = useExtract({ doc, settings: p.settings, fail, notify: setNotice })
  // テンポの解析（候補、BPM の設定）
  const tempo = useTempoDetect({ project, selected, updateTempo: doc.updateTempo, fail, notify: setNotice })

  // 録音（再生位置から、ほかのトラックを鳴らしながら録る）
  const { recording: audioRecording, midiRec, onMidiNote, live, toggleRecord, stopRecord } = useRecorder({ project, doc, selectedTrack, cursor, settings: p.settings, play, stopPlayer: () => (player.current.stop(), setPlaying(false)), position: () => player.current.position(), fail })
  // 音を録っているか、弾いた音符（MIDI）を録っているか
  const recording = audioRecording ?? (midiRec ? true : null)

  // MIDI キーボード: 弾いた音を、録音待機（なければ選んでいる、音源のある最初の）トラックの音源で鳴らす。録音中は MIDI ブロックに録る
  useMidiInput({
    enabled: p.settings.midiInput,
    device: p.settings.midiDevice,
    channel: p.settings.midiChannel,
    sustain: p.settings.midiSustain,
    onNote: (pitch, vel, on) => {
      // 開いているピアノロールのステップ入力にも渡す
      emitNote(pitch, vel, on)
      const tracks = project.tracks.filter((tr) => tr.instrument)
      // ピアノロールを開いているときは、そのブロックのトラック（画面の鍵盤と同じ）
      const rollId = dialogs.arg<string>('pianoRoll')
      const rollTrack = rollId ? midiBlocks(project).find((b) => b.id === rollId)?.track : undefined
      const target = tracks.find((tr) => tr.id === rollTrack) ?? tracks.find((tr) => tr.armed) ?? tracks.find((tr) => tr.id === selectedTrack) ?? tracks[0]
      if (!target) return
      void player.current.monitorNote(project, target.id, pitch, vel, on)
      onMidiNote(pitch, vel, on)
    },
    fail,
  })

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
  /** 編集カーソルを動かし、再生中なら再生もそこへ（目盛りと空いている所） */
  const seek = (time: number) => {
    moveCursor(time)
    if (playing) {
      void player.current.play(project, time).catch(fail)
      setPlayPos(time)
    } else setPlayPos(null)
  }

  // 何もない状態で最初に読み込んだ音からは、テンポを自動で解析する（設定）
  const load = (files: File[], at?: DropAt) => {
    const first = project.blocks.length === 0
    return doc
      .addFiles(files, at)
      .then((added) => (first && p.settings.autoTempo && added[0] ? tempo.detectClip(added[0].clip) : undefined))
      .catch(fail)
  }

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
    onWvsp: (file) =>
      void readWvsp(file)
        .then((r) => doc.apply((q) => addWvspTracks(q, file.name.replace(/\.[^.]+$/, ''), r.tracks.map((t) => ({ name: t.info.name, clip: t.edited })), cursor)))
        .catch(fail),
    confirmDiscard: () => confirm({ message: t('confirm.discard'), okLabel: t('confirm.discardOk'), danger: true }),
    fail,
    notify: setNotice,
    onExported: () => dialogs.close('export'),
  })


  const { menus, blockMenu, emptyMenu, envelopeMenu, commands } = useActions({
    envKind,
    envPen,
    setEnvPen,
    seekAfterInsert: p.settings.seekAfterInsert,
    doc,
    cursor,
    playing,
    defaultFade: p.settings.defaultBlockFade ? p.settings.defaultBlockFadeMs / 1000 : 0,
    play,
    stop,
    pause,
    repeat,
    recording: !!recording,
    detectTempo: () => void tempo.detect(),
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
        const fresh = newProject(p.settings.defaultBpm)
        doc.replace(fresh, 'history.new')
        files.markSaved(fresh)
        setFileName('untitled')
        setSelected([])
        setRange(null)
        setCursor(0)
      }),
    fit: (from, to) => {
      // 両端に少し余白を残す
      const len = Math.max(0.1, to - from)
      const pps = Math.min(2000, Math.max(2, (timelineWidth * 0.9) / len))
      setView({ pps, scroll: Math.max(0, from - (len * 0.05)) })
    },
    playAt: (at) => {
      setCursor(at)
      setPaused(null)
      setPlayPos(at)
      void player.current.play(project, at).then(() => player.current.playing && setPlaying(true)).catch(fail)
    },
    end,
    openDialog: (id, arg) => dialogs.open(id, arg),
    // 動画の書き出し: 追加機能「変換」を確かめ、プレビューに使う音を作ってから開く
    exportWvsp: () => files.exportWvsp(selectedTracks),
    saveOptimized: () => dialogs.open('optimize', selected),
    exportVideo: () =>
      void (async () => {
        if (!(await addonInstall.ensure(CONVERTER_ADDON))) return
        dialogs.open('video', await files.renderPreview())
      })().catch(fail),
    bake: (ids) => void bake(ids),
    extract: { vocals: (id) => void extract.splitVocals(id), lead: (id) => void extract.splitLead(id), instruments: (id) => void extract.splitInstruments(id), voices: (id, by) => void extract.splitVoices(id, by) },
    voiceSplit: p.settings.showVoiceSplit,
    newWindow: () =>
      void openWindowCount().then((n) => (n >= p.settings.maxWindows && !p.settings.extraWindows ? setNotice(t('window.limit', { n: p.settings.maxWindows })) : openNewWindow())),
    zoom: (f) => setView((v) => ({ ...v, pps: Math.min(2000, Math.max(2, v.pps * f)) })),
    // 選んでいるものの中を開いたら、選んでいるもの全部を一括で
    openProperties: (id: string) => dialogs.open('block', selected.includes(id) ? selected : [id]),
    openFile: files.picker.open,
    importFiles: () => {
      importTarget.current = undefined
      audioInput.current?.click()
    },
    // MIDI ブロックを MIDI ファイルに書き出す（選んだもの。なければ全部）
    exportMidi: (ids) => {
      const data = buildMidi(project, ids)
      if (!data) return setNotice(t('midi.exportEmpty'))
      downloadBlob(new Blob([data as BlobPart], { type: 'audio/midi' }), `${fileName.replace(/\.[^.]+$/, '')}.mid`)
    },
    // MIDI ファイルを選んで、トラックと MIDI ブロックにする（編集カーソルの位置から）
    importMidi: () => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.mid,.midi,audio/midi'
      input.onchange = () => {
        const file = input.files?.[0]
        if (file) void readMidi(file).then((m) => (m ? dialogs.open('midiImport', m) : setNotice(t('midi.empty')))).catch(fail)
      }
      input.click()
    },
    importAt: (time, track) => {
      importTarget.current = track ? { track, start: time } : undefined
      audioInput.current?.click()
    },
    save: files.save,
    saveAs: files.saveAs,
    folder: files.canSaveToFolder ? { saveRange: files.saveRangeToFolder, saveBlocks: files.saveBlocksToFolder } : null,
    recent: files.recent,
    openExport: () => dialogs.open('export'),
    openSettings: () => dialogs.open('settings'),
    openHistory: () => dialogs.open('history'),
    snap: p.settings.snap,
    toggleSnap: () => p.onSettingsChange({ snap: !p.settings.snap }),
    follow: p.settings.followPlayhead,
    envelope: p.settings.envelope,
    // 音量とピッチのエンベロープは、どちらか一方だけを出す
    toggleEnvelope: () => p.onSettingsChange({ envelope: !p.settings.envelope, pitchEnvelope: false, autoEdit: false }),
    pitchEnvelope: p.settings.pitchEnvelope,
    pitchEnvelopeRange: p.settings.pitchEnvelopeRange,
    envelopeRange: p.settings.envelopeRange,
    togglePitchEnvelope: () => p.onSettingsChange({ pitchEnvelope: !p.settings.pitchEnvelope, envelope: false, autoEdit: false }),
    autoEdit: p.settings.autoEdit,
    toggleAutoEdit: () => p.onSettingsChange({ autoEdit: !p.settings.autoEdit, envelope: false, pitchEnvelope: false }),
    toggleFollow: () => p.onSettingsChange({ followPlayhead: !p.settings.followPlayhead }),
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
    help: {
      guide: () => openExternal(`${app.repository}/blob/main/docs/MANUAL.md`),
      shortcuts: () => dialogs.open('shortcuts'),
      // 新しい版があれば右下の通知から更新できる。ここでは結果だけを知らせる（WeVocalSynth と同じ）
      checkUpdate: () =>
        void checkForUpdate().then((r) => {
          if (r.kind === 'found') return promptUpdate(r.build)
          if (r.kind === 'failed') return fail(t('toast.updateFailed'))
          setNotice(t(r.kind === 'latest' ? 'toast.updateLatest' : 'toast.updateUnsupported'))
        }),
      licenses: () => dialogs.open('licenses'), about: () => dialogs.open('about') },
  })

  // 起動時の復元と自動保存（WeVocalSynth と同じ）
  useAutosave({ project, fileName, autoRestore: p.settings.autoRestore && slot !== null, replace: doc.replace, setFileName, fail, notify: setNotice, onRestored: () => setRestored(true), restored })
  // 再生中の同期（範囲の終わりで止める、変更の反映、ピッチを変えた音の準備と進み具合）
  usePlayerSync({ player: player.current, project, cursor, playing, range, repeat, end, setPlayPos, setPlaying, fail, onMade: () => setMadeVersion((v) => v + 1) })

  // 波形ブロックか範囲を選んでいるとき、編集のボタンの列（設定で、スマホとタブレットだけか、すべてか、出さないかを選ぶ）。パソコンはツールバーの下、スマホは波形マップの下
  const touchLike = mobile || isMobile()
  const editBarOn = editBarEnabled(p.settings.editBar, touchLike)
  // タッチの端末では、最初に波形ブロックを置いたときに、長押しとダブルタップの操作を一度だけ知らせる（見つけにくいため）
  const hasBlocks = project.blocks.length > 0
  useEffect(() => {
    if (!touchLike || !hasBlocks) return
    try {
      if (localStorage.getItem(TOUCH_HINT_KEY)) return
      localStorage.setItem(TOUCH_HINT_KEY, '1')
    } catch {
      return
    }
    setNotice(t('hint.touch'))
  }, [touchLike, hasBlocks, t])
  const editBar = editBarOn && (selected.length > 0 || range) ? <BlockEditBar commands={commands} mode={selected.length > 0 ? (selected.every((id) => midiBlocks(project).some((b) => b.id === id)) ? 'midi' : 'block') : 'range'} top={!touchLike} /> : null

  return (
    // 設定などのダイアログを、PC では別のウィンドウに出す（WeVocalSynth と同じ）
    <WindowModeContext.Provider value={p.settings.dialogWindow === 'auto' ? autoWindowMode() : p.settings.dialogWindow}>
    <SliderResetContext.Provider value={p.settings.sliderDoubleClickReset}>
    <DocContext.Provider value={doc}>
    <Box
      sx={{ height: FULL_HEIGHT, display: 'flex', flexDirection: 'column', overflow: 'hidden', bgcolor: 'background.default' }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        files.openFiles(Array.from(e.dataTransfer.files))
      }}
    >
      <AppHeader menus={menus} canUndo={doc.canUndo} canRedo={doc.canRedo} onUndo={doc.undo} onRedo={doc.redo} projectName={fileName} dirty={files.dirty} />
      <Toolbar
        follow={p.settings.followPlayhead}
        snap={p.settings.snap}
        envelope={p.settings.envelope}
        onEnvelope={commands.envelope.run}
        pitchEnvelope={p.settings.pitchEnvelope}
        onPitchEnvelope={commands.pitchEnvelope.run}
        envKind={envKind}
        envPen={envPen}
        onEnvPen={setEnvPen}
        canEnvReset={commands.envelopeReset.enabled !== false}
        onEnvReset={commands.envelopeReset.run}
        canCut={commands.cut.enabled !== false}
        canPaste={commands.paste.enabled !== false}
        hasBlocks={selected.length > 0}
        hasRange={!!range}
        canSplit={commands.split.enabled !== false}
        canDuplicate={commands.duplicate.enabled !== false}
        canDelete={commands.delete.enabled !== false}
        canProperties={commands.properties.enabled !== false}
        canTrimRange={commands.trimRange.enabled !== false}
        onSplit={commands.split.run}
        onDuplicate={commands.duplicate.run}
        onDelete={commands.delete.run}
        onProperties={commands.properties.run}
        onTrimRange={commands.trimRange.run}
        onClearSelection={commands.clearRange.run}
        onFollow={commands.follow.run}
        onSnap={commands.snap.run}
        onZoom={(f) => setView((v) => ({ ...v, pps: Math.min(2000, Math.max(2, v.pps * f)) }))}
        onCut={commands.cut.run}
        onCopy={commands.copy.run}
        onPaste={commands.paste.run}
        selectMode={selectMode}
        selectionCount={selectedTracks.length || selected.length}
        showSelectMode={touchLike}
        onToggleSelectMode={() => {
          if (!selectMode && selected.length > 0) setSelectedTracks([])
          setSelectMode(!selectMode)
          setRange(null)
        }}
      />
      {!touchLike && editBar}
      <input ref={audioInput} type="file" accept={AUDIO_ACCEPT} multiple hidden onChange={(e) => void load(Array.from(e.target.files ?? []), importTarget.current).finally(() => (e.target.value = ''))} />
      {files.picker.input}

      <Box sx={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex', flexDirection: 'column' }}>
      <Timeline
        project={shown}
        tree={project}
        onTrackOp={(op, id) => {
          if (op === 'addSubtrack') setSelectedTrack(doc.addSubtrack(id))
          else if (op === 'indent') doc.indentTrack(id)
          else doc.outdentTrack(id)
        }}
        onMoveTrack={moveVisibleTrack}
        cursor={cursor}
        livePos={livePos}
        recording={!!recording}
        live={live}
        follow={p.settings.followPlayhead}
        onCursor={moveCursor}
        selectedTrack={selectedTrack}
        onSelectTrack={setSelectedTrack}
        selectMode={selectMode}
        onSeek={seek}
        headerWidth={header}
        headerBar={headerBar}
        headerCollapsed={headerCollapsed}
        wheelZoom={p.settings.wheelZoom}
        onToggleHeader={toggleHeader}
        onTrackChange={(id, patch, merge) => {
          // 選んでいるトラックの一つを変えたら、選んだもの全部に同じだけ掛ける（音量、パン、高さは差分で）
          if (selectedTracks.length < 2 || !selectedTracks.includes(id) || 'name' in patch || 'fx' in patch) return doc.updateTrack(id, patch, merge)
          const base = project.tracks.find((tr) => tr.id === id)!
          doc.updateTracks(
            Object.fromEntries(
              project.tracks
                .filter((tr) => selectedTracks.includes(tr.id))
                .map((tr) => {
                  const q: Partial<Track> = { ...patch }
                  if (patch.volume !== undefined) q.volume = Math.max(-60, Math.min(12, tr.volume + patch.volume - base.volume))
                  if (patch.pan !== undefined) q.pan = Math.max(-1, Math.min(1, tr.pan + patch.pan - base.pan))
                  // 高さも差分で（選んだトラックの高さの違いは保ったまま、同じだけ広げ縮めする）
                  if (patch.height !== undefined) q.height = Math.max(TRACK_HEIGHT_MIN, Math.min(TRACK_HEIGHT_MAX, trackHeight(tr) + patch.height - trackHeight(base)))
                  return [tr.id, q]
                }),
            ),
            merge,
          )
        }}
        onDropFiles={(list, at) => (list.some(isProjectLike) ? files.openFiles(list) : void load(list, at))}
        onBlockMenu={(_, x, y) => setMenuAt({ x, y })}
        onEmptyMenu={(kind, time, track, x, y, marker) => setEmptyAt({ kind, time, track, x, y, marker })}
        onCopyBlocks={(blocks) => void doc.insertBlocks(blocks)}
        onMarkerEdit={(id) => dialogs.open('marker', id)}
        onProperties={(id) => dialogs.open('block', selected.includes(id) ? selected : [id])}
        onFx={(id) => dialogs.open('fx', id)}
        meter={p.settings.showMeters ? player.current.meter : undefined}
        masterMeter={p.settings.showMeters ? player.current.masterMeters : undefined}
        onFreezeTrack={freeze}
        onTrackProperties={(ids) => dialogs.open('trackProperties', ids)}
        onSends={(id) => dialogs.open('sends', id)}
        onRemoveTrack={(id) => {
          doc.removeTrack(id)
          setSelected([])
        }}
        view={view}
        snap={p.settings.snap}
        playing={playing}
        grid={p.settings.grid}
        division={p.settings.gridDivision}
        envKind={envKind}
        envPen={envPen}
        onEnvMenu={(block, index, x, y) => setEnvAt({ block, index, x, y })}
        envelopeRange={p.settings.envelopeRange}
        pitchEnvelopeRange={p.settings.pitchEnvelopeRange}
        autoEdit={p.settings.autoEdit}
        onMidiEdit={(id) => dialogs.open('pianoRoll', id)}
        onAutoChange={(target, slot, param, points, merge) => {
          const fx = target === 'master' ? project.master.fx : project.tracks.find((tr) => tr.id === target)?.fx
          if (!fx?.[slot]) return
          const next = fx.map((s, i) => (i === slot ? { ...s, auto: { ...s.auto, [param]: points } } : s))
          if (target === 'master') doc.updateMaster({ fx: next }, merge)
          else doc.updateTrack(target, { fx: next }, merge)
        }}
        onView={setView}
        onWidth={setTimelineWidth}
        madeVersion={madeVersion}
        pendingLabel={t('status.pitchBlock')}
      />
      {/* 何も置いていないときの案内（開く、音を作る、録音、最近使用したファイル。部品は PevenMUI の EmptyState。WeVocalSynth と同じ）。時間軸の操作は妨げない */}
      {project.blocks.length === 0 && !midiBlocks(project).length && project.tracks.length <= 1 && !recording && (
        <Box sx={{ position: 'absolute', inset: 0, boxSizing: 'border-box', pl: `${header + 16}px`, pr: 2, pointerEvents: 'none', '& button': { pointerEvents: 'auto' } }}>
          <EmptyState
            message={t('empty.formats')}
            primary={{ label: t('empty.choose'), icon: faFolderOpen, onClick: commands.import.run }}
            actions={[{ label: t('synth.open'), icon: faWaveSquare, onClick: commands.synth.run }, ...(canRecord() ? [{ label: t('record.title'), icon: faMicrophone, onClick: commands.record.run }] : [])]}
            recent={files.recent.supported ? { title: t('menu.recent'), names: files.recent.names, open: files.recent.open, more: (n) => t('empty.showMore', { n }), less: t('empty.showLess') } : undefined}
          />
        </Box>
      )}
      </Box>
      {!mobile && <DockArea />}
      {p.settings.showAnalysis && (
        <AnalysisPanel
          bpm={project.tempo.bpm}
          f0MinHz={p.settings.f0MinHz}
          f0MaxHz={p.settings.f0MaxHz}
          flattenStrength={p.settings.flattenStrength}
          block={project.blocks.find((b) => b.id === selected[0]) ?? null}
          source={sourceOf(project.blocks.find((b) => b.id === selected[0])?.source)}
          view={view}
          headerWidth={header}
          version={madeVersion}
          range={range}
          onCurve={(curve, merge) => {
            const id = selected[0]
            if (id) doc.updateBlock(id, { curve }, merge)
          }}
          onEndMerge={doc.endMerge}
        />
      )}
      {overview && project.blocks.length > 0 && (
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
          showPlayhead={p.settings.minimapPlayhead}
        />
        </Box>
      )}
      {touchLike && editBar}
      <Transport
        playing={playing}
        position={playPos ?? cursor}
        livePosition={() => livePos() ?? cursor}
        onSeek={seek}
        meter={p.settings.showMeters ? <LevelMeter source={player.current.masterMeters} rows={2} width={96} height={7} label={t('meter.master')} /> : null}
        end={end}
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
      <ContextMenu position={envAt} entries={envAt ? envelopeMenu(envAt.block, envAt.index) : []} onClose={() => setEnvAt(null)} />
      <ContextMenu position={emptyAt} entries={emptyAt ? emptyMenu(emptyAt.kind, emptyAt.time, emptyAt.track, emptyAt.marker) : []} onClose={() => setEmptyAt(null)} />
      <AppDialogs dialogs={dialogs} settings={p.settings} onSettingsChange={p.onSettingsChange} doc={doc} fileName={fileName} onRenameProject={setFileName} onExport={files.runExport} onOptimize={files.saveOptimized} onVideoExport={files.runVideoExport} fail={fail} cursor={cursor} prepareSeparate={extract.prepareSeparate} ensure={addonInstall.ensure} playing={playing} position={() => player.current.position()} onTogglePlay={() => (playing ? pause() : play())} onPlayRange={playRoll} repeat={repeat} onRepeat={setRepeat} onSeek={seek} load={renderLoad} onPreview={(track, pitch, vel, on) => void player.current.monitorNote(project, track, pitch, vel, on)} />

      {!mobile && p.settings.showStatusBar && (
        <StatusBar
          fileName={fileName}
          dirty={files.dirty}
          onRename={setFileName}
          duration={Math.max(end, range?.end ?? 0)}
          onQuickSave={files.canSaveToFolder ? files.saveRangeToFolder : undefined}
          sampleRate={48000}
          tracks={project.tracks.length}
          range={range}
          onRange={setRange}
          tempo={<TempoField bpm={project.tempo.bpm} candidates={tempo.candidates} analyzing={tempo.analyzing} onChange={tempo.setBpm} onAnalyze={() => void tempo.detect()} labels={{ tap: t('tempo.tap'), tapHint: t('tempo.tapHint'), candidates: t('tempo.candidates'), analyze: t('tempo.analyze'), analyzing: t('tempo.analyzing') }} />}
          bpm={project.tempo.bpm}
        />
      )}

      <NoticeMessage message={error === null ? null : { severity: 'error', message: t('error.failed', { error }) }} onClose={() => setError(null)} autoHideMs={8000} />
      {confirmDialog}
      {extract.dialog}
      {addonInstall.dialog}
      {addonFolderNotice}
      {p.settings.showDebug && <DebugOverlay build={BUILD} extra={() => player.current.debugLines()} />}
      <UpdatePrompt build={BUILD} devUpdates={p.settings.devUpdates} />
      <NoticeMessage message={notice ? { severity: 'info', message: notice } : null} onClose={() => setNotice(null)} vertical={touchLike ? 'top' : 'bottom'} horizontal={touchLike ? 'center' : 'left'} />
    </Box>
    </DocContext.Provider>
    </SliderResetContext.Provider>
    </WindowModeContext.Provider>
  )
}
