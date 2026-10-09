// 画面の組み立て。上のバー、時間軸、選んだ波形ブロックの欄、ステータスバー
import { useEffect, useRef, useState } from 'react'
import { Alert, Box, Link, Snackbar } from '@mui/material'
import { AboutDialog, AppHeader, FULL_HEIGHT, LicensesDialog, StatusBar, StatusItem, StatusSpacer, useMobileLayout, type MenuGroup } from 'pevenmui'
import { AUDIO_ACCEPT, downloadBlob } from 'wevocal-lib'
import { app } from './appConfig'
import BlockPanel from './BlockPanel'
import { pitchPending, preparePitch } from './dsp/pitch'
import { Player, renderWav } from './engine'
import { useT } from './i18n'
import { actionOf, keyLabel, type Action } from './keymap'
import SettingsDialog from './SettingsDialog'
import type { Settings } from './settings'
import Timeline from './Timeline'
import { useProject, type DropAt } from './useProject'

/** 今動いている版 */
const BUILD = `${__APP_VERSION__} (${__APP_COMMIT__})`

/** アプリのアイコン（public/icon.svg）。サブパスで配信されても読めるよう BASE_URL から組み立てる */
const AppIcon = ({ size }: { size: number }) => <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" width={size} height={size} style={{ display: 'block' }} />

const openExternal = (url: string) => window.open(url, '_blank', 'noopener,noreferrer')

const formatTime = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`

export default function App(p: { settings: Settings; onSettingsChange: (patch: Partial<Settings>) => void }) {
  const t = useT()
  const mobile = useMobileLayout()
  const { project, addFiles, addTrack, updateMaster, updateTrack, updateBlock, removeBlock, nudgePitch, split } = useProject({ algorithm: p.settings.algorithm, preserveFormant: p.settings.preserveFormant })
  const player = useRef(new Player())
  const [playing, setPlaying] = useState(false)
  const [cursor, setCursor] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pitching, setPitching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [licensesOpen, setLicensesOpen] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const block = project.blocks.find((b) => b.id === selected)

  const play = () => {
    player.current.play(project, cursor)
    setPlaying(true)
  }
  const stop = () => {
    setCursor(player.current.position())
    player.current.stop()
    setPlaying(false)
  }
  const seek = (time: number) => {
    setCursor(time)
    if (playing) player.current.play(project, time)
  }
  const exportWav = async () => {
    setBusy(true)
    try {
      downloadBlob(await renderWav(project), 'mix.wav')
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }
  const splitAtCursor = () => split(cursor, selected ?? undefined)
  const deleteSelected = () => {
    if (selected) removeBlock(selected)
    setSelected(null)
  }

  // 再生中は位置を動かす
  useEffect(() => {
    if (!playing) return
    let id = 0
    const tick = () => {
      setCursor(player.current.position())
      id = requestAnimationFrame(tick)
    }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
  }, [playing])

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
      .catch((e: unknown) => alive && setError(String(e)))
      .finally(() => alive && setPitching(false))
    return () => {
      alive = false
    }
  }, [project])

  const load = (files: File[], at?: DropAt) => addFiles(files, at).catch((err: unknown) => setError(String(err)))

  /** キーとメニューから行う操作 */
  const actions: Record<Action, () => void> = {
    playStop: () => (playing ? stop : play)(),
    split: splitAtCursor,
    delete: deleteSelected,
    pitchUp: () => selected && nudgePitch(selected, 1),
    pitchDown: () => selected && nudgePitch(selected, -1),
    pitchUpFine: () => selected && nudgePitch(selected, 0.1),
    pitchDownFine: () => selected && nudgePitch(selected, -0.1),
    pitchReset: () => selected && nudgePitch(selected, null),
  }

  // キーの割り当ては keymap.ts の表
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return
      const action = actionOf(e)
      if (!action) return
      e.preventDefault()
      actions[action]()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const menus: MenuGroup[] = [
    {
      label: t('menu.file'),
      accessKey: 'F',
      entries: [
        { label: t('menu.import'), onClick: () => fileInput.current?.click() },
        { label: t('menu.exportWav'), disabled: busy || project.blocks.length === 0, onClick: () => void exportWav() },
        { divider: true },
        { label: t('menu.settings'), onClick: () => setSettingsOpen(true) },
      ],
    },
    {
      label: t('menu.edit'),
      accessKey: 'E',
      entries: [
        { label: t('menu.split'), shortcut: keyLabel('split'), onClick: splitAtCursor },
        { label: t('menu.delete'), shortcut: keyLabel('delete'), disabled: !selected, onClick: deleteSelected },
        { divider: true },
        { label: t('menu.pitchUp'), shortcut: keyLabel('pitchUp'), disabled: !selected, onClick: actions.pitchUp },
        { label: t('menu.pitchDown'), shortcut: keyLabel('pitchDown'), disabled: !selected, onClick: actions.pitchDown },
        { label: t('menu.pitchUpFine'), shortcut: keyLabel('pitchUpFine'), disabled: !selected, onClick: actions.pitchUpFine },
        { label: t('menu.pitchDownFine'), shortcut: keyLabel('pitchDownFine'), disabled: !selected, onClick: actions.pitchDownFine },
        { label: t('menu.pitchReset'), shortcut: keyLabel('pitchReset'), disabled: !selected, onClick: actions.pitchReset },
      ],
    },
    {
      label: t('menu.track'),
      accessKey: 'T',
      entries: [{ label: t('menu.addTrack'), onClick: addTrack }],
    },
    {
      label: t('menu.transport'),
      accessKey: 'P',
      entries: [
        { label: playing ? t('menu.stop') : t('menu.play'), shortcut: keyLabel('playStop'), onClick: actions.playStop },
        { label: t('menu.toStart'), onClick: () => seek(0) },
      ],
    },
    {
      label: t('menu.view'),
      accessKey: 'V',
      entries: [{ label: t('menu.statusBar'), checked: p.settings.showStatusBar, onClick: () => p.onSettingsChange({ showStatusBar: !p.settings.showStatusBar }) }],
    },
    {
      label: t('menu.help'),
      accessKey: 'H',
      entries: [
        { label: t('menu.guide'), onClick: () => openExternal(app.repository) },
        { label: t('menu.licenses'), onClick: () => setLicensesOpen(true) },
        { label: t('menu.about'), onClick: () => setAboutOpen(true) },
      ],
    },
  ]

  return (
    <Box
      sx={{ height: FULL_HEIGHT, display: 'flex', flexDirection: 'column', overflow: 'hidden', bgcolor: 'background.default' }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        void load([...e.dataTransfer.files])
      }}
    >
      <AppHeader icon={<AppIcon size={16} />} menus={menus} />
      <input ref={fileInput} type="file" accept={AUDIO_ACCEPT} multiple hidden onChange={(e) => void load([...(e.target.files ?? [])]).finally(() => (e.target.value = ''))} />

      <Timeline
        project={project}
        cursor={cursor}
        selected={selected}
        onSelect={setSelected}
        onSeek={seek}
        onMasterChange={updateMaster}
        onTrackChange={updateTrack}
        onDropFiles={(files, at) => void load(files, at)}
        onBlockChange={updateBlock}
      />
      {block && <BlockPanel block={block} name={project.sources.find((s) => s.id === block.source)?.name ?? ''} onChange={(patch) => updateBlock(block.id, patch)} />}

      {!mobile && p.settings.showStatusBar && (
        <StatusBar>
          <StatusItem>{busy ? t('status.exporting') : pitching ? t('status.pitch') : playing ? t('status.playing') : t('status.ready')}</StatusItem>
          <StatusItem>{formatTime(cursor)}</StatusItem>
          <StatusSpacer />
          <StatusItem secondary>{BUILD}</StatusItem>
        </StatusBar>
      )}

      <Snackbar open={!!error} autoHideDuration={8000} onClose={() => setError(null)}>
        <Alert severity="error" onClose={() => setError(null)}>
          {t('error.failed', { error: error ?? '' })}
        </Alert>
      </Snackbar>
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} settings={p.settings} onChange={p.onSettingsChange} />
      <LicensesDialog
        open={licensesOpen}
        onClose={() => setLicensesOpen(false)}
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
        open={aboutOpen}
        onClose={() => setAboutOpen(false)}
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
