// 撮影の手順で共通に使う部品
import { openApp, sleep } from './app.mjs'

/** ツールバーのボタン（左から順。表示しているものだけ） */
export const toolbarButtons = (b) =>
  b.evaluate(`[...document.querySelectorAll('button')]
    .map((e) => ({ e, r: e.getBoundingClientRect() }))
    .filter(({ r }) => r.width > 0 && r.top > 33 && r.bottom < 75)
    .sort((a, b) => a.r.left - b.r.left)
    .map(({ e, r }) => ({ label: e.getAttribute('aria-label') ?? e.textContent.trim(), x: r.x + r.width / 2, y: r.y + r.height / 2, right: r.right }))`)

/** 文字が `text` の要素の位置。一致するもののうち、いちばん内側の要素（下線などで文字が分かれていてもよい） */
export const textRect = (b, text, where = 'true') =>
  b.rect(`[...document.querySelectorAll('body *')].filter((e) => e.textContent.trim() === ${JSON.stringify(text)} && (() => { const r = e.getBoundingClientRect(); return r.width > 0 && (${where}) })()).pop()`)

/** ピッチパネルを表示し、範囲を選択した、パソコンの基本の画面 */
export async function desktopMain(base, opts = {}) {
  const b = await openApp(base, opts)
  await b.clickLabel('ピッチ表示')
  await sleep(2500)
  await b.drag(383, 300, 703, 300)
  await sleep(800)
  await b.park()
  return b
}

/** 開いているダイアログを、周りに 16px の余白を付けて撮る */
export async function dialogShot(b, file) {
  await b.park()
  const r = await b.rect(`[...document.querySelectorAll('[role=dialog]')].pop()`)
  await b.shot(file, { x: r.x - 16, y: r.y - 16, width: r.width + 32, height: r.height + 32 })
}
