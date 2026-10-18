// docs/images の画像ごとの撮影の手順（run.mjs から呼ぶ）。手順を足したら docs/WRITING.md の「画像」も直す
import { DESKTOP } from './desktop.mjs'
import { DIALOGS } from './dialogs.mjs'
import { MOBILE } from './mobile.mjs'

export const SHOTS = { ...DESKTOP, ...DIALOGS, ...MOBILE }
