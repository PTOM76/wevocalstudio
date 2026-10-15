// プロジェクトの開く、保存（上書きと名前を付けて）、書き出し、最近使用したファイル、OS から開く、閉じる前の確認（WeVocalSynth と同じ PevenMUI の fileAccess）
import { useEffect, useRef, useState } from 'react'
import { startJob, useFilesPicker, useLeaveGuard, useRecentFiles } from 'pevenmui'
import { canSaveToFolder, configureFileAccess, fileRefOf, saveToFolder, initFileAccess, overwriteTarget, pickSaveTarget, rememberLaunched, type SavedFile } from 'pevenmui/web'
import { AUDIO_ACCEPT, WVSP_EXT, isWvspFile, EXPORT_EXT, EXPORT_MIME, encodeWav, exportAudio, finishClip, toFrames, type Range } from 'wevocal-lib'
import { renderMix } from './engine'
import type { ExportSettings } from 'wevocal-lib/react'
import { VIDEO_EXT, VIDEO_MIME, type VideoLook } from 'wevocalconverter/host'
import type { VideoExportSettings } from 'wevocalconverter/VideoExportDialog'
import { videoHost } from './addons'
import type { useT } from './i18n'
import type { Project } from './project'
import { exportWvsp } from './wvspExport'
import { LEGACY_PROJECT_EXT, PROJECT_EXT, readProject, writeProject } from './projectFile'
import type { Settings } from './settings/settings'
import { idbGet, idbPut } from './storage/idb'

// 最近使用したファイルの記録先と、フォルダーを覚える用途の名前の頭
initFileAccess({ store: { get: idbGet, put: async (k, v) => void (await idbPut(k, v)) }, idPrefix: 'wevocalstudio' })

const isProjectFile = (f: File) => [PROJECT_EXT, LEGACY_PROJECT_EXT].some((e) => f.name.toLowerCase().endsWith(e))
/** 音声ではなく、プロジェクトとして開くファイル（.wvst、.wvsp）。音声として読み込むと失敗する */
export const isProjectLike = (f: File) => isProjectFile(f) || isWvspFile(f)

export function useProjectFile(o: {
  t: ReturnType<typeof useT>
  settings: Settings
  project: Project
  fileName: string
  range: Range | null
  /** 開いたプロジェクトに切り替える（再生を止め、選択を消す） */
  onOpened: (p: Project, name: string) => void
  /** 音声ファイルを今のプロジェクトに読み込む */
  onAudio: (files: File[]) => void
  /** WeVocalSynth のプロジェクト（.wvsp）を今のプロジェクトに読み込む */
  onWvsp: (file: File) => void
  /** 保存していない変更を捨ててよいか確かめる */
  confirmDiscard: () => Promise<boolean>
  fail: (e: unknown) => void
  /** 書き出し終わったとき（ダイアログを閉じる） */
  onExported: () => void
  notify: (message: string) => void
}) {
  const { t, settings } = o
  // 保存したとき（開いたとき）のプロジェクト。今と違えば変更あり（名前の後ろに *）
  const [saved, setSaved] = useState(o.project)
  const dirty = o.project !== saved && o.project.blocks.length + saved.blocks.length > 0
  // 上書きする先（選ぶ画面で開いたか保存したファイル。なければ保存で選ぶ）
  const fileRef = useRef<SavedFile | null>(null)

  // 描画中に入れる（メニューの最近使用したファイルが、最初の描画から設定に合うように）
  configureFileAccess({ rememberFolder: settings.rememberFolder, startFolder: settings.startFolder, recentFiles: settings.recentFiles, pickerMode: settings.filePicker })

  const openProjectFile = async (file: File) => {
    if (dirty && !(await o.confirmDiscard())) return
    try {
      const p = await readProject(file, () => o.notify(t('toast.newerFormat')))
      fileRef.current = fileRefOf(file) ?? null
      setSaved(p)
      o.onOpened(p, file.name.replace(/\.[^.]+$/, ''))
    } catch (e) {
      o.fail(e)
    }
  }
  /** プロジェクトは開き、音声は今のプロジェクトに読み込む */
  const openFiles = (files: File[]) => {
    const proj = files.find(isProjectFile)
    if (proj) return void openProjectFile(proj)
    files.filter(isWvspFile).forEach(o.onWvsp)
    const audio = files.filter((f) => !isWvspFile(f))
    if (audio.length) o.onAudio(audio)
  }
  const picker = useFilesPicker(`${PROJECT_EXT},${LEGACY_PROJECT_EXT},${WVSP_EXT},${AUDIO_ACCEPT}`, openFiles, t('file.openType'))
  const recent = useRecentFiles(
    (f) => openFiles([f]),
    (name) => o.fail(t('toast.recentMissing', { file: name })),
  )

  const save = async (asNew = false) => {
    const prev = !asNew && fileRef.current
    const target =
      (prev && (await overwriteTarget(prev, true))) ||
      (await pickSaveTarget(`${o.fileName}${PROJECT_EXT}`, 'project', { description: t('file.projectType'), mime: 'application/octet-stream', ext: PROJECT_EXT }, window, true))
    if (!target) return
    const p = o.project
    try {
      await target.write(writeProject(p))
      fileRef.current = target.file ?? fileRef.current
      setSaved(p)
      o.notify(t('toast.saved'))
    } catch (e) {
      o.fail(e)
    }
  }

  /** 書き出す音（全トラックを混ぜ、範囲があれば切り出してから仕上げを掛ける。音声、動画、フォルダーへの保存で共通。WeVocalSynth と同じ） */
  const renderFinished = async (p: Project, range: Range | null) => {
    let mix = await renderMix(p, range ? range.end : 0)
    if (range) {
      const [s, e] = toFrames(mix, range)
      mix = { sampleRate: mix.sampleRate, channels: mix.channels.map((ch) => ch.slice(s, e)) }
    }
    return finishClip(mix, { normalize: settings.exportNormalize, fadeMs: settings.exportFadeMs })
  }

  const runExport = async (c: ExportSettings, win?: Window | null) => {
    // 保存先は作る前に選ぶ（時間がかかると、選ぶ画面を出せなくなる）
    const ext = EXPORT_EXT[c.format]
    const target = await pickSaveTarget(`${c.fileName.trim()}${ext}`, 'audio', { description: t('file.audioType'), mime: EXPORT_MIME[c.format], ext }, win ?? window)
    if (!target) return
    // 進み具合はステータスバーのゲージに出す（WeVocalSynth と同じ startJob）
    const job = startJob('export', t('job.export'))
    job.update(-1)
    try {
      const mix = await renderFinished(o.project, c.selectionOnly ? o.range : null)
      await target.write(await exportAudio(mix, { ...c, sampleRate: c.sampleRate || mix.sampleRate, range: null }))
      o.onExported()
    } catch (e) {
      o.fail(e)
    } finally {
      job.end()
    }
  }

  /** WeVocalSynth のプロジェクト（.wvsp）に書き出す（トラックごとに描画。選んだトラックがなければ全トラック） */
  const runWvspExport = async (selected: string[]) => {
    const target = await pickSaveTarget(`${o.fileName}${WVSP_EXT}`, 'wvsp', { description: t('file.wvspType'), mime: 'application/octet-stream', ext: WVSP_EXT })
    if (!target) return
    const job = startJob('export', t('job.export'))
    job.update(-1)
    try {
      await target.write(await exportWvsp(o.project, o.fileName, selected, (v) => job.update(v)))
    } catch (e) {
      o.fail(e)
    } finally {
      job.end()
    }
  }

  /** 範囲（全トラックを混ぜたもの）を切り出して WAV にする。仕上げは書き出しと同じ */
  const renderRange = async (p: Project, r: Range) => encodeWav(await renderFinished(p, r))

  /** 動画の書き出し（追加機能「変換」。音は音声の書き出しと同じもの。WeVocalSynth と同じ） */
  const runVideoExport = async (v: VideoExportSettings, look: VideoLook, win?: Window | null) => {
    const ext = VIDEO_EXT[v.container]
    const target = await pickSaveTarget(`${v.fileName.trim()}${ext}`, 'video', { description: t('video.fileType'), mime: VIDEO_MIME[v.container], ext }, win ?? window)
    if (!target) return
    const job = startJob('export', t('job.export'))
    job.update(-1)
    try {
      const clip = await renderFinished(o.project, v.selectionOnly ? o.range : null)
      await target.write(await videoHost.renderVideo(clip, { ...look, container: v.container, fps: 30, kbps: 192, onProgress: (p) => job.update(p) }))
      o.onExported()
      o.notify(t('toast.exported'))
    } catch (e) {
      o.fail(e)
    } finally {
      job.end()
    }
  }
  const folderFailed = (e: unknown) => (o.fail(t('folder.failed', { error: String(e) })), null)
  /** 範囲をフォルダーへ保存する（初回はフォルダーを選ぶ。名前は「プロジェクト名_連番.wav」。WeVocalSynth と同じ） */
  const saveRangeToFolder = async () => {
    if (!o.range) return
    const r = await saveToFolder('export', o.fileName, '.wav', await renderRange(o.project, o.range)).catch(folderFailed)
    if (r) o.notify(t('folder.saved', { name: r.name, folder: r.folder }))
  }
  /** 選んだ波形ブロックを、1 つずつ別のファイルにして保存する（その波形ブロックだけを鳴らした音） */
  const saveBlocksToFolder = async (ids: string[]) => {
    let last: { folder: string; name: string } | null = null
    let count = 0
    for (const b of o.project.blocks.filter((x) => ids.includes(x.id)).sort((a, c) => a.start - c.start)) {
      const only = { ...o.project, blocks: [{ ...b, mute: false }], tracks: o.project.tracks.map((tr) => (tr.id === b.track ? { ...tr, mute: false, solo: false } : tr)) }
      const saved = await saveToFolder('export', o.fileName, '.wav', await renderRange(only, { start: b.start, end: b.start + b.length })).catch(folderFailed)
      if (!saved) break
      last = saved
      count++
    }
    if (last) o.notify(t('folder.savedMany', { n: count, folder: last.folder }))
  }

  // 自動保存がオフなら、閉じる前に確かめる（オンなら次に開いたときに戻せる）
  useLeaveGuard(settings.confirmClose && !settings.autoRestore, () => dirty)

  // OS でファイルをダブルクリックして起動したとき（インストールした PWA の File Handling。vite.config.ts の file_handlers）
  const openRef = useRef(openFiles)
  openRef.current = openFiles
  useEffect(() => {
    const queue = (window as Window & { launchQueue?: { setConsumer(f: (p: { files?: { getFile(): Promise<File> }[] }) => void): void } }).launchQueue
    queue?.setConsumer((p) => {
      const handle = p.files?.[0]
      if (!handle) return
      void handle.getFile().then((f) => {
        rememberLaunched(handle, f)
        openRef.current([f])
      })
    })
  }, [])

  return {
    dirty,
    /** 今のプロジェクトを保存した状態とみなす（新規、復元） */
    markSaved: (p: Project) => {
      fileRef.current = null
      setSaved(p)
    },
    openFiles,
    picker,
    recent,
    save: () => void save(),
    saveAs: () => void save(true),
    exportWvsp: (selected: string[]) => void runWvspExport(selected),
    runExport: (c: ExportSettings, win?: Window | null) => void runExport(c, win),
    runVideoExport: (v: VideoExportSettings, look: VideoLook, win?: Window | null) => void runVideoExport(v, look, win),
    /** 動画のプレビューに使う音（全体） */
    renderPreview: () => renderFinished(o.project, null),
    /** フォルダーへ保存できるブラウザか（Chrome、Edge） */
    canSaveToFolder: canSaveToFolder(),
    saveRangeToFolder: () => void saveRangeToFolder(),
    saveBlocksToFolder: (ids: string[]) => void saveBlocksToFolder(ids),
  }
}
