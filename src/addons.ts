// 配信している追加機能の一覧と、このアプリでの呼び名（導入と読み込みの仕組みは PevenMUI。一覧は extractor の host.ts。WeVocalSynth と同じ）
import { createAddons, type AddonInfo, type AddonsContextValue } from 'pevenmui'
import { EXTRACTOR_ADDONS } from 'wevocalextractor/host'
import { CONVERTER_ADDON, createVideoHost } from 'wevocalconverter/host'
import { ANALYZER_ADDONS, createKanaHost } from 'wevocalanalyzer/kanaCut'
import { APP_INFO } from './appInfo'
import { t, type MessageKey } from './i18n'
import { idb } from './storage/idb'

/** 追加機能。ボーカル抽出の実行環境とモデル、変換（導入した人だけが取得する） */
export const ADDONS: AddonInfo<MessageKey>[] = [
  ...EXTRACTOR_ADDONS.map((a) => ({ ...a, requires: 'requires' in a ? [...a.requires] : undefined })),
  // 解析、歌詞の文字化とそのモデル（一音ずつ切り出しに使う。一覧は analyzer）
  ...ANALYZER_ADDONS.map((a) => ({ ...a, requires: 'requires' in a ? [...a.requires] : undefined })),
  // 変換（converter/ の WeVocalConverter）。今は動画の書き出しに使う
  { id: CONVERTER_ADDON, name: 'addon.converter' },
]

// 選んだフォルダーの中の置き場所は WeVocal のアプリで共通（同じフォルダーを選べば、同じモデルを使う。vite.config.ts と一致させる）
const addons = createAddons({ appId: APP_INFO.id, idb, addons: ADDONS, base: import.meta.env.BASE_URL, folderName: 'wevocal-addons' })

/** 部品とフックが使う追加機能（main.tsx の AddonsContext に入れる） */
export const addonsContext: AddonsContextValue = {
  addons,
  nameOf: (id, short) => {
    const info = ADDONS.find((a) => a.id === id)
    return info ? t((short && info.shortName) || info.name) : id
  },
}

export const { installedManifest, addonFileUrl, loadAddon, addonsSizeIn, clearAddonsIn } = addons
/** 追加機能の保存先のフォルダー（試験的。設定の addonFolder） */
export const addonFolder = addons.folder
/** 保存先の名前（Cache Storage。設定の「データ」で消す） */
export const ADDON_CACHE = addons.cacheName

/** 動画の書き出しの手順（追加機能「変換」。converter の host.ts） */
export const videoHost = createVideoHost((id) => loadAddon(id))

/** 一音ずつ切り出す手順（追加機能「歌詞の文字化」と「解析」。analyzer の kanaCut.ts） */
export const kanaHost = createKanaHost((id) => loadAddon(id))
