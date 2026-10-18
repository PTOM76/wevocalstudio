// 追加機能の保存先のフォルダー（試験的）。許可の通知と、設定と自動保存した作業の写しは PevenMUI の useAddonFolderSync（WeVocalSynth と同じ）
import { useState } from 'react'
import { NoticeMessage, useAddonFolderSync, type NoticeMessageData } from 'pevenmui'
import { setAutosaveFolder } from './storage/autosave'
import { dataFolder, restoreFromFolder } from './storage/dataFolder'

/** 設定がオンなら保存先をフォルダーにして写しを始め、知らせる通知を返す */
export function useAddonFolder(enabled: boolean) {
  const [notice, setNotice] = useState<NoticeMessageData | null>(null)
  useAddonFolderSync({
    enabled,
    dataFolder,
    setAutosaveFolder,
    restore: restoreFromFolder,
    notify: setNotice,
  })
  return <NoticeMessage message={notice} onClose={() => setNotice(null)} />
}
