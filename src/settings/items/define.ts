// 設定の項目を定義する関数（check、choice、number、value）。仕組みは PevenMUI の settingItems（WeVocalSynth と共通）。ここは訳文のキーと分類の型を決めるだけ
import { settingItems, type AnyItem as PevenAnyItem } from 'pevenmui'
import type { MessageKey } from '../../i18n'
import type { Category } from '../settingsSearch'

export const { check, choice, number, value, defineItems } = settingItems<MessageKey, Category>()
export type AnyItem = PevenAnyItem<MessageKey>
export { searchKeys } from 'pevenmui'
