// 追加機能の保存先のフォルダー（試験的。WeVocalSynth と同じ。memo/addon-folder.md は Synth）。開いたときに許可がなければ、通知から許可してもらう
import { useEffect, useState } from 'react'
import { NoticeMessage } from 'pevenmui'
import { addonFolder, notifyAddonsChanged } from './addons'
import { t } from './i18n'

/** 設定がオンなら保存先をフォルダーにし、許可を求める通知を返す（Service Worker からは許可を求められない） */
export function useAddonFolder(enabled: boolean) {
  const [ask, setAsk] = useState(false)
  useEffect(() => {
    addonFolder.setEnabled(enabled)
    setAsk(false)
    if (!enabled) return
    void addonFolder.permission().then((p) => setAsk(p === 'prompt'))
  }, [enabled])
  const allow = () => {
    setAsk(false)
    void addonFolder.requestPermission().then((ok) => ok && notifyAddonsChanged())
  }
  return (
    <NoticeMessage
      message={ask ? { severity: 'info', message: t('addonFolder.permission'), actions: [{ label: t('addonFolder.allow'), onClick: allow }] } : null}
      onClose={() => setAsk(false)}
    />
  )
}
