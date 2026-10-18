// ダイアログの撮影の手順
import { sleep } from './app.mjs'
import { desktopMain, dialogShot } from './common.mjs'

export const DIALOGS = {
  /** 動画として書き出す画面（追加機能「変換」） */
  async video({ base, out }) {
    const b = await desktopMain(base, { addons: ['converter'], height: 1150 })
    await b.clickText('ファイル(F)')
    await b.clickText('動画として書き出す')
    await b.waitFor(`[...document.querySelectorAll('[role=dialog] img')].some((e) => e.complete && e.naturalWidth > 0)`)
    await dialogShot(b, out('video.png'))
    b.close()
  },

  /** 音声ファイルを書き出す画面 */
  async export({ base, out }) {
    const b = await desktopMain(base)
    await b.clickText('ファイル(F)')
    await b.clickText('音声ファイルを書き出す')
    await sleep(1000)
    await dialogShot(b, out('export.png'))
    b.close()
  },

  /** ボーカル抽出を初めて使うときの、ダウンロードの確認 */
  async extract({ base, out }) {
    const b = await desktopMain(base)
    await b.clickText('ツール(T)')
    await b.clickText('ボーカルを抽出')
    await b.waitFor(`[...document.querySelectorAll('[role=dialog]')].some((e) => /MB/.test(e.textContent))`)
    await dialogShot(b, out('extract.png'))
    b.close()
  },

  /** 音声を作成する画面 */
  async synth({ base, out }) {
    const b = await desktopMain(base)
    await b.clickText('ツール(T)')
    await b.clickText('音声を作成')
    await sleep(1000)
    await dialogShot(b, out('synth.png'))
    b.close()
  },

  /** 設定の画面 */
  async settings({ base, out }) {
    const b = await desktopMain(base)
    await b.clickText('ファイル(F)')
    await b.clickText('設定')
    await sleep(1000)
    await dialogShot(b, out('settings.png'))
    // 追加機能の分類（ダウンロードと削除）
    await b.clickText('追加機能')
    await b.waitFor(`[...document.querySelectorAll('[role=dialog]')].some((e) => /MB/.test(e.textContent))`)
    await dialogShot(b, out('addons.png'))
    b.close()
  },
}
