// 設定画面の分類の並びと、検索の対象（WeVocalSynth と同じ形）
import type { SettingsCategory } from 'pevenmui'
import { canPickFiles } from 'pevenmui/web'
import type { MessageKey } from '../i18n'
import { ACTIONS } from '../keymap'
import { GROUPS } from './items'
import { searchKeys, type AnyItem } from './items/define'

/** 設定画面の分類 */
export type Category = 'general' | 'edit' | 'keys' | 'file' | 'display' | 'pitch' | 'data' | 'debug'
/** 並び順と親子（親のない分類と、その下のサブアイテム） */
const TREE: [Category, Category?][] = [['general'], ['edit', 'general'], ['keys', 'general'], ['file', 'general'], ['display'], ['pitch'], ['data'], ['debug']]

/** 検索の対象のうち、定義（items/）にないもの: グループ名と、自前の画面の項目の訳文キー */
const INDEX: Record<Category, MessageKey[]> = {
  general: ['settings.groupStartup', 'settings.groupOutput', 'settings.outputDevice', 'settings.outputDeviceHelp', 'settings.groupRecord', 'settings.inputDevice', 'settings.groupUpdate', 'menu.checkUpdate'],
  edit: ['settings.groupHistory', 'settings.groupInput'],
  keys: ['settings.groupShortcuts', ...ACTIONS.map((a) => `menu.${a.id}` as MessageKey)],
  file: ['settings.groupFile'],
  display: ['settings.groupAppearance', 'settings.language'],
  pitch: ['settings.algorithm'],
  data: ['settings.groupData', 'data.work', 'data.workHelp', 'data.cache', 'data.cacheHelp', 'data.settings', 'data.settingsHelp', 'data.all', 'data.persist', 'data.persistHelp'],
  debug: ['settings.groupDebug', 'settings.dialogWindow'],
}

/** 分類の検索の対象（手で書いたものと、定義から集めたもの） */
function searchIndex(c: Category): MessageKey[] {
  const fromItems = GROUPS.filter((g) => g.page === c).flatMap((g) => (Object.values(g.items) as AnyItem[]).flatMap((i) => searchKeys(i)))
  return [...new Set([...INDEX[c], ...fromItems])]
}

/** 設定画面に渡す分類の一覧。「ファイル」は File System Access API が使えるブラウザだけ出す（WeVocalSynth と同じ） */
export function settingsCategories(t: (key: MessageKey) => string): SettingsCategory<Category>[] {
  return TREE.filter(([c]) => c !== 'file' || canPickFiles()).map(([c, parent]) => ({ id: c, label: t(`settings.cat.${c}`), texts: searchIndex(c).map((k) => t(k)), parent }))
}
