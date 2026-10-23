// ダイアログの撮影の手順
import { sleep } from './app.mjs'
import { desktopMain, dialogShot } from './common.mjs'

/** メニューを順にたどって開く */
async function menu(b, ...items) {
  for (const item of items) await b.clickText(item)
  await sleep(1000)
}

export const DIALOGS = {
  /** 波形ブロックのプロパティ */
  async properties({ base, out }) {
    const b = await desktopMain(base, { height: 1100 })
    await menu(b, 'ブロック(I)', 'プロパティ')
    await dialogShot(b, out('properties.png'))
    b.close()
  },

  /** トラックの FX（コンプレッサーを 1 つ足したところ） */
  async fx({ base, out }) {
    const b = await desktopMain(base, { height: 1000 })
    await b.clickLabel('FX', true)
    await sleep(1000)
    await b.clickText('追加')
    await b.clickText('WevCompressor')
    await sleep(1000)
    await dialogShot(b, out('fx.png'))
    b.close()
  },

  /** 動画ファイルに書き出す画面（追加機能「変換」） */
  async video({ base, out }) {
    const b = await desktopMain(base, { addons: ['converter'], height: 1150 })
    await menu(b, 'ファイル(F)', '動画ファイルに書き出す')
    await b.waitFor(`[...document.querySelectorAll('[role=dialog] img, [role=dialog] canvas')].length > 0`)
    await sleep(1000)
    await dialogShot(b, out('video.png'))
    b.close()
  },

  /** 音声ファイルを書き出す画面 */
  async export({ base, out }) {
    const b = await desktopMain(base, { height: 1000 })
    await menu(b, 'ファイル(F)', '書き出す')
    await dialogShot(b, out('export.png'))
    b.close()
  },

  /** ボーカル抽出を初めて使うときの、ダウンロードの確認 */
  async extract({ base, out }) {
    const b = await desktopMain(base)
    await menu(b, 'ツール(L)', 'ボーカル抽出', 'ボーカルと伴奏')
    await b.waitFor(`[...document.querySelectorAll('[role=dialog]')].some((e) => /MB/.test(e.textContent))`)
    await dialogShot(b, out('extract.png'))
    b.close()
  },

  /** 音声を作成する画面 */
  async synth({ base, out }) {
    const b = await desktopMain(base, { height: 1000 })
    await menu(b, 'ツール(L)', '音声を作成')
    await dialogShot(b, out('synth.png'))
    b.close()
  },

  /** 設定の画面 */
  async settings({ base, out }) {
    const b = await desktopMain(base)
    await menu(b, 'ファイル(F)', '設定')
    await dialogShot(b, out('settings.png'))
    // 追加機能の分類（ダウンロードと削除）
    await b.clickText('追加機能')
    await b.waitFor(`[...document.querySelectorAll('[role=dialog]')].some((e) => /MB/.test(e.textContent))`)
    await dialogShot(b, out('addons.png'))
    b.close()
  },
}
