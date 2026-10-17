// 設定と自動保存した作業を、指定したフォルダーにも写す（PWA を消しても戻せるように。処理は PevenMUI。WeVocalSynth と同じ）。画面と自動保存の Worker の両方から使う
import { createDataFolder } from 'pevenmui/web'
import { APP_INFO } from '../appInfo'
import { app } from '../appConfig'
import { idbGet, idbPut } from './idb'

export const dataFolder = createDataFolder({ appId: APP_INFO.id, idbGet, localPrefix: app.key('') })
/** 写した設定と作業をブラウザに戻す。何か戻したら true（そのあと再読み込みする） */
export const restoreFromFolder = () => dataFolder.restore(idbPut)
