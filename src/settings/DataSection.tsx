// 設定の「データ」（使用量と削除。部品と処理は PevenMUI。WeVocalSynth と同じ）
import { useEffect, useState } from 'react'
import { Button } from '@mui/material'
import { DangerButton, DataRow, DataText, useConfirm } from 'pevenmui'
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
  const { confirm, dialog } = useConfirm()
  const refresh = () => {
    void storageUsage().then(setUsage)
    void isPersisted().then(setPersisted)
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
                await Promise.all([idbClear(), clearOfflineCache()])
                clearSettings()
                location.reload()
              },
              'data.allDone',
            )
          }
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
      {message && <DataText done>{message}</DataText>}
      {dialog}
    </>
  )
}
