// 設定の「データ」（使用量と、作業データ、キャッシュ、追加機能、設定の削除。部品と処理は PevenMUI。WeVocalSynth と同じ）
import { useEffect, useState } from 'react'
import { Box, Button } from '@mui/material'
import { DangerButton, DataHeading, DataRow, DataText, useConfirm, useDownloadingIds } from 'pevenmui'
import { ADDON_CACHE, addonFolder, addonsSizeIn, clearAddonsIn } from '../addons'
import { dataFolder, restoreFromFolder } from '../storage/dataFolder'
import { clearLocalItems, clearOfflineCache, formatMb, isPersisted, requestPersist, storageUsage } from 'pevenmui/web'
import { app } from '../appConfig'
import { useT, type MessageKey } from '../i18n'
import { idbClear } from '../storage/idb'

/** 設定の「データ」: ブラウザ内の使用量と、作業データ、オフライン用キャッシュ、設定の削除 */
export default function DataSection({ onClose }: { onClose: () => void }) {
  const t = useT()
  const [usage, setUsage] = useState<Awaited<ReturnType<typeof storageUsage>>>(null)
  const [persisted, setPersisted] = useState<boolean | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [addonBytes, setAddonBytes] = useState(0)
  // 追加機能の保存先のフォルダー（試験的）。選んでいて許可があるときだけ、そのデータを分けて表示する
  const [folder, setFolder] = useState<{ name: string; bytes: number; dataBytes: number } | null>(null)
  // 追加機能のダウンロード中は、追加機能を消す操作を押せなくする（書きかけを消して壊さないため）
  const downloading = useDownloadingIds().size > 0
  const { confirm, dialog } = useConfirm()
  const refresh = () => {
    void storageUsage().then(setUsage)
    void isPersisted().then(setPersisted)
    void addonsSizeIn('cache').then(setAddonBytes)
    void (async () => {
      const dir = await addonFolder.saved()
      setFolder(dir && (await addonFolder.permission()) === 'granted' ? { name: dir.name, bytes: await addonsSizeIn('folder'), dataBytes: await dataFolder.mirroredSize() } : null)
    })()
  }
  useEffect(refresh, [])

  /** 確認してから `run` し、結果を表示する */
  const act = async (ok: MessageKey, ask: MessageKey, run: () => Promise<void> | void, done: MessageKey) => {
    if (!(await confirm({ message: t(ask), okLabel: t(ok), danger: true }))) return
    await run()
    setMessage(t(done))
    refresh()
  }
  const clearSettings = () => clearLocalItems(app.key(''))

  return (
    <>
      {/* 保存先のフォルダーがあるときは、ブラウザ内と保存先フォルダーに分けて見出しを出す */}
      {folder && <DataHeading>{t('data.browser')}</DataHeading>}
      <DataText>{usage ? t('data.usage', { usage: formatMb(usage.usage), quota: formatMb(usage.quota) }) : t('data.usageUnknown')}</DataText>
      {/* 何が容量を使っているかの内訳（Chrome などだけ） */}
      {usage?.details && (
        <DataText note>{t('data.usageDetails', { caches: formatMb(usage.details.caches ?? 0), idb: formatMb(usage.details.indexedDB ?? 0), sw: formatMb(usage.details.serviceWorkerRegistrations ?? 0) })}</DataText>
      )}
      <DataRow label={t('data.work')} help={t('data.workHelp')}>
        <DangerButton label={t('data.delete')} onClick={() => void act('data.delete', 'data.workConfirm', async () => void (await idbClear()), 'data.workDone')} />
      </DataRow>
      <DataRow label={t('data.cache')} help={t('data.cacheHelp')}>
        <DangerButton label={t('data.delete')} onClick={() => void act('data.delete', 'data.cacheConfirm', () => clearOfflineCache(), 'data.cacheDone')} />
      </DataRow>
      <DataRow label={t('data.addons')} help={t('data.addonsHelp', { size: formatMb(addonBytes) })}>
        <DangerButton label={t('data.delete')} disabled={downloading} onClick={() => void act('data.delete', 'data.addonsConfirm', () => clearAddonsIn('cache'), 'data.addonsDone')} />
      </DataRow>
      <DataRow label={t('data.settings')} help={t('data.settingsHelp')}>
        <DangerButton
          label={t('data.reset')}
          onClick={() =>
            void act(
              'data.reset',
              'data.settingsConfirm',
              () => {
                clearSettings()
                // 開いている設定画面の値は古いので、閉じて読み込み直す
                onClose()
                location.reload()
              },
              'data.settingsDone',
            )
          }
        />
      </DataRow>
      <DataRow label={t('data.all')} help={t('data.allHelp')}>
        <DangerButton
          label={t('data.deleteAll')}
          onClick={() =>
            void act(
              'data.deleteAll',
              'data.allConfirm',
              async () => {
                await Promise.all([idbClear(), clearOfflineCache([ADDON_CACHE])])
                clearSettings()
                location.reload()
              },
              'data.allDone',
            )
          }
          disabled={downloading}
        />
      </DataRow>
      <DataRow label={t('data.persist')} help={t(persisted ? 'data.persistOn' : 'data.persistHelp')}>
        <Button
          size="small"
          variant="outlined"
          disabled={persisted !== false}
          onClick={() => void requestPersist().then((ok) => (setPersisted(ok), setMessage(t(ok ? 'data.persistDone' : 'data.persistDenied'))))}
          sx={{ flexShrink: 0 }}
        >
          {t('data.persistButton')}
        </Button>
      </DataRow>
      {folder && (
        <>
          <DataHeading>{t('data.folder', { name: folder.name })}</DataHeading>
          <DataRow label={t('data.addons')} help={t('data.folderAddonsHelp', { size: formatMb(folder.bytes) })}>
            <DangerButton label={t('data.delete')} disabled={downloading} onClick={() => void act('data.delete', 'data.folderAddonsConfirm', () => clearAddonsIn('folder'), 'data.addonsDone')} />
          </DataRow>
          {/* 写した設定と作業（PWA を入れ直したときは、ここから戻す。storage/dataFolder.ts） */}
          <DataRow label={t('data.folderData')} help={t('data.folderDataHelp', { size: formatMb(folder.dataBytes) })}>
            <Box sx={{ display: 'flex', gap: 1, flexShrink: 0 }}>
              <Button
                size="small"
                variant="outlined"
                disabled={!folder.dataBytes}
                onClick={() =>
                  void (async () => {
                    if (!(await confirm({ message: t('data.folderRestoreConfirm'), okLabel: t('data.folderRestore') }))) return
                    if (await restoreFromFolder()) location.reload()
                  })()
                }
              >
                {t('data.folderRestore')}
              </Button>
              <DangerButton label={t('data.delete')} disabled={!folder.dataBytes} onClick={() => void act('data.delete', 'data.folderDataConfirm', dataFolder.mirrorClearAll, 'data.folderDataDone')} />
            </Box>
          </DataRow>
        </>
      )}
      {message && <DataText done>{message}</DataText>}
      {dialog}
    </>
  )
}
