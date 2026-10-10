// プロジェクトの開く、保存（上書きと名前を付けて）、書き出し、最近使用したファイル、OS から開く、閉じる前の確認（WeVocalSynth と同じ PevenMUI の fileAccess）
import { useEffect, useRef, useState } from 'react'
import { startJob, useFilesPicker, useLeaveGuard, useRecentFiles } from 'pevenmui'
import { configureFileAccess, fileRefOf, initFileAccess, overwriteTarget, pickSaveTarget, rememberLaunched, type SavedFile } from 'pevenmui/web'
import { AUDIO_ACCEPT, EXPORT_EXT, EXPORT_MIME, exportAudio, finishClip, toFrames, type Range } from 'wevocal-lib'
import { renderMix } from './engine'
import type { ExportSettings } from 'wevocal-lib/react'
import type { useT } from './i18n'
import type { Project } from './project'
import { PROJECT_EXT, readProject, writeProject } from './projectFile'
import type { Settings } from './settings/settings'
import { idbGet, idbPut } from './storage/idb'

// 最近使用したファイルの記録先と、フォルダーを覚える用途の名前の頭
initFileAccess({ store: { get: idbGet, put: async (k, v) => void (await idbPut(k, v)) }, idPrefix: 'wevocalstudio' })

const isProjectFile = (f: File) => f.name.toLowerCase().endsWith(PROJECT_EXT)

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
      const p = await readProject(file)
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
    if (files.length) o.onAudio(files)
  }
  const picker = useFilesPicker(`${PROJECT_EXT},${AUDIO_ACCEPT}`, openFiles, t('file.openType'))
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

  const runExport = async (c: ExportSettings, win?: Window | null) => {
    // 保存先は作る前に選ぶ（時間がかかると、選ぶ画面を出せなくなる）
    const ext = EXPORT_EXT[c.format]
    const target = await pickSaveTarget(`${c.fileName.trim()}${ext}`, 'audio', { description: t('file.audioType'), mime: EXPORT_MIME[c.format], ext }, win ?? window)
    if (!target) return
    // 進み具合はステータスバーのゲージに出す（WeVocalSynth と同じ startJob）
    const job = startJob('export', t('job.export'))
    job.update(-1)
    try {
      const range = c.selectionOnly ? o.range : null
      let mix = await renderMix(o.project, range ? range.end : 0)
      // 範囲を切り出してから仕上げ（ノーマライズ、両端のフェード）を掛ける（WeVocalSynth と同じ）
      if (range) {
        const [s, e] = toFrames(mix, range)
        mix = { sampleRate: mix.sampleRate, channels: mix.channels.map((ch) => ch.slice(s, e)) }
      }
      mix = finishClip(mix, { normalize: settings.exportNormalize, fadeMs: settings.exportFadeMs })
      await target.write(await exportAudio(mix, { ...c, sampleRate: c.sampleRate || mix.sampleRate, range: null }))
      o.onExported()
    } catch (e) {
      o.fail(e)
    } finally {
      job.end()
    }
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
    runExport: (c: ExportSettings, win?: Window | null) => void runExport(c, win),
  }
}
