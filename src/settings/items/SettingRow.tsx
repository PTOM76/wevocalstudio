// 項目の定義から設定画面の 1 行を作る（部品は PevenMUI の SettingRow。WeVocalSynth と同じ）
import { SettingRow as PevenSettingRow } from 'pevenmui'
import type { MessageKey } from '../../i18n'
import { ITEMS, type Settings } from '.'

export default function SettingRow({ name, draft, set, t }: { name: keyof Settings; draft: Settings; set: (patch: Partial<Settings>) => void; t: (key: MessageKey) => string }) {
  return <PevenSettingRow item={ITEMS[name]} value={draft[name]} onChange={(v) => set({ [name]: v } as Partial<Settings>)} t={t} />
}
