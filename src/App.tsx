// 画面の組み立て。上のバー、時間軸、選んだ波形ブロックの欄、ステータスバー
import { useEffect, useRef, useState } from 'react'
import { Box, Link, Typography } from '@mui/material'
import { AboutDialog, AppHeader, FULL_HEIGHT, LicensesDialog, StatusBar, StatusItem, StatusSpacer, useMobileLayout, type MenuGroup } from 'pevenmui'
import { AUDIO_ACCEPT, downloadBlob } from 'wevocal-lib'
import { app } from './appConfig'
import BlockPanel from './BlockPanel'
import { Player, renderWav } from './engine'
import { useT } from './i18n'
import SettingsDialog from './SettingsDialog'
import type { Settings } from './settings'
import Timeline from './Timeline'
import { useProject } from './useProject'

/** 今動いている版 */
const BUILD = `${__APP_VERSION__} (${__APP_COMMIT__})`

/** アプリのアイコン（public/icon.svg）。サブパスで配信されても読めるよう BASE_URL から組み立てる */
const AppIcon = ({ size }: { size: number }) => <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" width={size} height={size} style={{ display: 'block' }} />

const openExternal = (url: string) => window.open(url, '_blank', 'noopener,noreferrer')

const formatTime = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`

export default function App(p: { settings: Settings; onSettingsChange: (patch: Partial<Settings>) => void }) {
  const t = useT()
  const mobile = useMobileLayout()
  const { project, addFiles, addTrack, updateTrack, updateBlock, removeBlock, split } = useProject()
  const player = useRef(new Player())
  const [playing, setPlaying] = useState(false)
  const [cursor, setCursor] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
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
  useEffect(() => {
    if (player.current.playing) player.current.play(project, player.current.position())
  }, [project])

  // キー: Space 再生と停止、S 分割、Delete 削除（REAPER と同じ）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.ctrlKey || e.metaKey || e.altKey) return
      if (e.code === 'Space') (playing ? stop : play)()
      else if (e.key === 's' || e.key === 'S') splitAtCursor()
      else if (e.key === 'Delete') deleteSelected()
      else return
      e.preventDefault()
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
        { label: t('menu.split'), onClick: splitAtCursor },
        { label: t('menu.delete'), disabled: !selected, onClick: deleteSelected },
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
        { label: playing ? t('menu.stop') : t('menu.play'), onClick: playing ? stop : play },
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
        void addFiles([...e.dataTransfer.files])
      }}
    >
      <AppHeader icon={<AppIcon size={16} />} menus={menus} />
      <input ref={fileInput} type="file" accept={AUDIO_ACCEPT} multiple hidden onChange={(e) => void addFiles([...(e.target.files ?? [])]).finally(() => (e.target.value = ''))} />

      {project.tracks.length === 0 ? (
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 3 }}>
          <Typography color="text.secondary">{t('main.empty')}</Typography>
        </Box>
      ) : (
        <Timeline
          project={project}
          cursor={cursor}
          selected={selected}
          onSelect={setSelected}
          onSeek={seek}
          onTrackChange={updateTrack}
          onBlockChange={updateBlock}
        />
      )}
      {block && <BlockPanel block={block} name={project.sources.find((s) => s.id === block.source)?.name ?? ''} onChange={(patch) => updateBlock(block.id, patch)} />}

      {!mobile && p.settings.showStatusBar && (
        <StatusBar>
          <StatusItem>{busy ? t('status.exporting') : playing ? t('status.playing') : t('status.ready')}</StatusItem>
          <StatusItem>{formatTime(cursor)}</StatusItem>
          <StatusSpacer />
          <StatusItem secondary>{BUILD}</StatusItem>
        </StatusBar>
      )}

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
