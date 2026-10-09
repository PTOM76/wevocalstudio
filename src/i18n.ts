// 多言語化（訳文は lang/ の JSON）
import { createI18n } from 'pevenmui'
import en from './lang/en_us.json'
import ja from './lang/ja_jp.json'

/**
 * 多言語化。訳文は lang/ の JSON（名前は ja_jp の形）。キーは en_us.json を正とし、ほかの言語に欠けたキーがあると型エラーになる。
 * 言語を足すときは JSON を置き、ここの import と messages に足す
 */
export const i18n = createI18n({
  messages: { en_us: en, ja_jp: ja },
})

export type Lang = typeof i18n.Lang
export type LangSetting = 'auto' | Lang
export type MessageKey = typeof i18n.Key

export const { t, useT } = i18n
