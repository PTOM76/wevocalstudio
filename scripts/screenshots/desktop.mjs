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
    const inspector = await textRect(b, '加工', 'r.left > 1000')
    const after = await textRect(b, '加工後')
    await b.note([
      [1, help.x + help.width + 17, help.y + help.height / 2],
      [2, tools[tools.length - 1].right + 24, tools[0].y],
      [3, 61, 85],
      [4, 560, 189],
      [5, 1078, 505],
      [6, 1000, 560],
      [7, 540, 821],
      [8, inspector.x + inspector.width + 50, inspector.y + inspector.height / 2],
      [9, 640, 848],
      [10, after.x - 25, after.y + after.height / 2],
    ])
    await b.shot(out('main_with_note.png'))
    b.close()
  },

  /** ツールバー（MANUAL の「ツールバー」の表の 1〜30 と対応）。スペクトログラムのボタンと、描いたあとのボタンも出す */
  async toolbar({ base, out }) {
    const b = await desktopMain(base, { addons: ['analyzer'] })
    // ピッチパネルにフォーカスし、ペンで描く（試聴、適用、破棄のボタンが出る）
    await b.click(900, 700)
    await b.clickLabel('ピッチを描く')
    await b.drag(420, 640, 680, 600, 20)
    await sleep(800)
    await b.park()
    const tools = await toolbarButtons(b)
    // 5 は再生位置の表示（ボタンではないが、クリックすると再生位置を入力できる）。時間の文字の下に置く
    const time = await b.rect(`[...document.querySelectorAll('body *')].filter((e) => /^\\d+:\\d\\d\\.\\d{3} \\/ \\d/.test(e.textContent.trim()) && e.getBoundingClientRect().top < 75).pop()`)
    const marks = tools.map((t) => [t.x])
    marks.splice(4, 0, [time.x + time.width / 2])
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
    if (marks.length !== 30) console.warn(`  ツールバーの番号が ${marks.length} 個（MANUAL の表は 30 個）。表を見直す`)
  },

  /** ライトテーマの画面 */
  async mainLight({ base, out }) {
    const b = await desktopMain(base, { settings: { theme: 'light' } })
    await b.shot(out('main-light.png'))
    b.close()
  },

  /** ピッチパネルだけを表示し、2 つ目のフレーズのピッチを描き直したところ */
  async pitch({ base, out }) {
    const b = await openApp(base)
    await b.clickLabel('ピッチ表示')
    await b.clickLabel('波形表示')
    await sleep(2500)
    await b.click(3, 400)
    await b.clickLabel('ピッチを描く')
    await b.drag(300, 250, 440, 250, 15)
    await b.drag(440, 330, 560, 330, 15)
    await sleep(800)
    await b.park()
    await b.shot(out('pitch.png'))
    b.close()
  },

  /** 音量パネルとフォルマントパネルに曲線を描いたところ */
  async curves({ base, out }) {
    const b = await openApp(base)
    await b.clickLabel('音量表示')
    await b.clickLabel('フォルマント表示')
    await sleep(2000)
    for (const [i, [y0, y1]] of [[570, 610], [720, 690]].entries()) {
      // 帯の左端をクリックしてフォーカスする（再生位置は先頭のまま）。ペンのモードは帯をまたいで共通なので、最初の 1 回だけ押す
      await b.click(3, y0)
      if (i === 0) await b.clickLabel('描く', true)
      await b.drag(120, y0, 560, y1, 20)
      await b.drag(560, y1, 900, y0, 20)
      await sleep(500)
    }
    await b.park()
    await b.shot(out('curves.png'))
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
    await b.clickLabel('ピッチ表示')
    await sleep(2500)
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
