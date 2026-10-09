// アプリの定義（名前、URL、保存のキー）を画面から使う形にする
import { defineApp } from 'pevenmui/web'
import { APP_INFO } from './appInfo'

/** アプリの定義（名前、URL、保存のキー） */
export const app = defineApp(APP_INFO)
