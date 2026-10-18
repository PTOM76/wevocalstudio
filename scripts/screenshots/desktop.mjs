// パソコンの画面の撮影の手順
import { dropMelody, openApp, sleep } from './app.mjs'
import { desktopMain, textRect, toolbarButtons } from './common.mjs'

export const DESKTOP = {
  /** パソコンの画面（README、wiki のトップでは使わない。MANUAL の「画面」） */
  async main({ base, out }) {
    const b = await desktopMain(base)
    await b.shot(out('main.png'))
    // 番号付き（MANUAL の「パソコン」の表と対応）
    const help = await textRect(b, 'ヘルプ(H)')
    const tools = await toolbarButtons(b)
    await b.note([
      [1, help.x + help.width + 17, help.y + help.height / 2],
      [2, tools[tools.length - 1].right + 24, tools[0].y],
      [3, 20, 85],
      [4, 240, 85],
      [5, 560, 189],
      [6, 540, 821],
      [7, 640, 848],
    ])
    await b.shot(out('main_with_note.png'))
    b.close()
  },

  /** ツールバー（MANUAL の「ツールバー」の表の 1〜30 と対応）。スペクトログラムのボタンと、描いたあとのボタンも出す */
  async toolbar({ base, out }) {
    const b = await desktopMain(base, { addons: ['analyzer'] })
    await sleep(800)
    await b.park()
    const tools = await toolbarButtons(b)
    const marks = tools.map((t) => [t.x])
    const bottom = 33 + 40
    // 下に番号を置く分、目盛りの上をツールバーの色で覆う
    await b.evaluate(`(() => {
      const bar = document.elementFromPoint(5, 40)
      let el = bar, bg = 'rgba(0, 0, 0, 0)'
      while (el && (bg = getComputedStyle(el).backgroundColor) === 'rgba(0, 0, 0, 0)') el = el.parentElement
      const c = document.createElement('div')
      c.className = 'shot-cover'
      Object.assign(c.style, { position: 'fixed', left: 0, top: '${bottom}px', width: '100vw', height: '14px', background: bg, zIndex: 99998 })
      document.body.append(c)
    })()`)
    await b.note(marks.map(([x], i) => [i + 1, x, bottom - 1]))
    const last = tools[tools.length - 1]
    await b.shot(out('toolbar_with_note.png'), { x: 0, y: 33, width: Math.ceil(last.right + 12), height: 52 })
    b.close()
    if (marks.length !== 30) console.warn(`  ツールバーの番号が ${marks.length} 個`)
  },

  /** ライトテーマの画面 */
  async mainLight({ base, out }) {
    const b = await desktopMain(base, { settings: { theme: 'light' } })
    await b.shot(out('main-light.png'))
    b.close()
  },

  /** スペクトログラムパネル（追加機能「解析」） */
  async spectrogram({ base, out }) {
    const b = await openApp(base, { addons: ['analyzer'] })
    await b.clickLabel('スペクトログラム表示')
    await sleep(5000)
    await b.park()
    await b.shot(out('spectrogram.png'))
    b.close()
  },

  /** 範囲を選択して右クリックしたところ */
  async context({ base, out }) {
    const b = await openApp(base)
    await b.drag(383, 300, 703, 300)
    await sleep(500)
    await b.rightClick(560, 300)
    await sleep(800)
    await b.mouse('mouseMoved', 1, 300)
    const m = await b.rect(`[...document.querySelectorAll('[role=menu]')].pop()`)
    await b.shot(out('context.png'), { x: m.x - 236, y: m.y - 236, width: m.width + 282, height: m.height + 286 })
    b.close()
  },

  /** トラックが 2 本あるとき（番号は MANUAL の「トラック」の表と対応） */
  async tracks({ base, out }) {
    const b = await openApp(base)
    await b.evaluate(dropMelody('harmony.wav', -4))
    await sleep(5000)
    await b.drag(383, 400, 703, 400)
    await sleep(800)
    await b.park()
    await b.shot(out('tracks.png'))
    const first = await textRect(b, 'melody.wav', 'r.top > 70 && r.top < 160')
    const second = await textRect(b, 'harmony.wav', 'r.top > 70 && r.top < 160')
    // 1 本目のトラック名の文字の右端（要素は M のボタンの手前まで広がっているので、文字の幅を測る）
    const nameEnd = await b.evaluate(`(() => {
      const e = [...document.querySelectorAll('body *')].filter((e) => e.textContent.trim() === 'melody.wav' && e.getBoundingClientRect().top < 160).pop()
      const range = document.createRange()
      range.selectNodeContents(e)
      return range.getBoundingClientRect().right
    })()`)
    // 2 本目のトラックの M、S、I のボタン
    const btn = (t) => textRect(b, t, 'r.top > 100 && r.top < 160')
    const [mute, solo, inv] = [await btn('M'), await btn('S'), await btn('I')]
    const below = (r) => [r.x + r.width / 2, r.y + r.height + 9]
    await b.note([
      [1, nameEnd + 11, first.y + first.height / 2],
      [2, ...below(mute)],
      [3, ...below(solo)],
      [4, ...below(inv)],
      [5, 1100, first.y + first.height / 2 + 14],
      [6, 600, (first.y + second.y) / 2 + 8],
    ])
    await b.shot(out('tracks_with_note.png'))
    b.close()
  },
}
