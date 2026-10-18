// スマホの画面の撮影の手順（幅 390 の画面を 2 倍の解像度で撮る）
import { openApp, sleep } from './app.mjs'
import { textRect } from './common.mjs'

const PORTRAIT = { width: 390, height: 844, mobile: true, scale: 2 }
const LANDSCAPE = { width: 844, height: 390, mobile: true, scale: 2 }

/** aria-label を含むボタンの中心 */
const center = async (b, label) => {
  const r = await b.labelRect(label)
  return [r.x + r.width / 2, r.y + r.height / 2]
}

export const MOBILE = {
  /** スマホの画面（番号は MANUAL の「スマホ」の表と対応） */
  async mobile({ base, out }) {
    const b = await openApp(base, PORTRAIT)
    await b.shot(out('mobile.png'))
    const [ux, uy] = await center(b, '元に戻す')
    const [rx, ry] = await center(b, 'やり直す')
    const [mx, my] = await center(b, 'メニュー')
    const zoom = await b.labelRect('縮小')
    const sel = await textRect(b, '選択範囲: —')
    const tab = await textRect(b, '音量', "e.getAttribute('role') === 'tab' || e.closest('[role=tab]')")
    const insp = await textRect(b, '自動判定: ボーカル')
    const play = await b.labelRect('再生 / 一時停止')
    await b.note(
      [
        [1, ux + 2, uy + 26],
        [2, rx + 2, ry + 26],
        [3, mx + 2, my + 26],
        [4, 40, 78],
        [5, 200, 300],
        [6, 335, zoom.y + zoom.height / 2],
        [7, sel.x + sel.width + 120, sel.y + sel.height / 2],
        [8, Math.min(tab.x + tab.width + 70, 365), tab.y + tab.height / 2],
        [9, 24, insp.y + insp.height / 2],
        [10, play.x + 8, play.y - 8],
        [11, 370, play.y - 8],
      ],
      24,
    )
    await b.shot(out('mobile_with_note.png'))
    b.close()
  },

  /** スマホでなぞって範囲を選択し、下に編集のボタンが表示されたところ */
  async mobileSelect({ base, out }) {
    const b = await openApp(base, PORTRAIT)
    await b.swipe(120, 300, 260, 300, 15)
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
