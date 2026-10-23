// スマホの画面の撮影の手順（幅 390 の画面を 2 倍の解像度で撮る）
import { openApp, sleep } from './app.mjs'

const PORTRAIT = { width: 390, height: 844, mobile: true, scale: 2 }
const LANDSCAPE = { width: 844, height: 390, mobile: true, scale: 2 }

export const MOBILE = {
  /** スマホの画面（縦持ちはトラックの欄を閉じている） */
  async mobile({ base, out }) {
    const b = await openApp(base, PORTRAIT)
    await b.shot(out('mobile.png'))
    b.close()
  },

  /** スマホで波形ブロックをタップし、下に編集バーが表示されたところ */
  async mobileSelect({ base, out }) {
    const b = await openApp(base, PORTRAIT)
    const r = await b.rect(`[...document.querySelectorAll('canvas')].sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height)[0]`)
    // 1 本目のトラック（マスターの下）の波形ブロック
    await b.tap(r.x + 60, r.y + 150)
    await sleep(1000)
    await b.shot(out('mobile-select.png'))
    b.close()
  },

  /** スマホを横向きにしたとき */
  async mobileLandscape({ base, out }) {
    const b = await openApp(base, LANDSCAPE)
    await b.shot(out('mobile-landscape.png'))
    b.close()
  },
}
