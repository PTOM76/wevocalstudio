// パソコンの画面の撮影の手順
import { openApp, sleep } from './app.mjs'
import { BLOCK, desktopMain, textRect, toolbarButtons } from './common.mjs'

/** 解析の欄（スペクトログラム）とミニマップを出す設定 */
const FULL = { settings: { showMinimap: true, showAnalysis: true }, addons: ['analyzer'] }

export const DESKTOP = {
  /** パソコンの画面（MANUAL の「パソコン」の表と対応） */
  async main({ base, out }) {
    const b = await desktopMain(base, FULL)
    // スペクトログラムを描き終えるまで待つ
    await sleep(6000)
    await b.park()
    await b.shot(out('main.png'))
    const help = await textRect(b, 'ヘルプ(H)')
    const tools = await toolbarButtons(b)
    const tab = await textRect(b, '解析', 'r.top > 300 && r.top < 600')
    const bar = await b.labelRect('先頭へ')
    await b.note([
      [1, help.x + help.width + 17, help.y + help.height / 2],
      [2, tools[tools.length - 1].right + 24, tools[0].y],
      [3, 760, 85],
      [4, 100, 460],
      [5, 900, 460],
      [6, 900, tab.y + 140],
      [7, 740, tab.y + 219],
      [8, 640, bar.y + bar.height / 2],
      [9, 640, 848],
    ])
    await b.shot(out('main_with_note.png'))
    b.close()
  },

  /** ツールバー（波形ブロックを選んだとき。MANUAL の「ツールバー」の表と対応） */
  async toolbar({ base, out }) {
    const b = await desktopMain(base)
    const tools = await toolbarButtons(b)
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
    await b.note(tools.map((t, i) => [i + 1, t.x, bottom - 1]))
    const last = tools[tools.length - 1]
    await b.shot(out('toolbar_with_note.png'), { x: 0, y: 33, width: Math.ceil(last.right + 12), height: 52 })
    b.close()
    if (tools.length !== 14) console.warn(`  ツールバーの番号が ${tools.length} 個（MANUAL の表は 14 個）`)
  },

  /** ライトテーマの画面 */
  async mainLight({ base, out }) {
    const b = await desktopMain(base, { settings: { theme: 'light' } })
    await b.shot(out('main-light.png'))
    b.close()
  },

  /** 波形ブロックを右クリックしたところ */
  async context({ base, out }) {
    const b = await desktopMain(base)
    await b.rightClick(...BLOCK)
    await sleep(800)
    await b.mouse('mouseMoved', 1, 600)
    const m = await b.rect(`[...document.querySelectorAll('[role=menu]')].pop()`)
    const x = Math.max(0, m.x - 120)
    await b.shot(out('context.png'), { x, y: m.y - 60, width: m.x + m.width + 16 - x, height: m.height + 76 })
    b.close()
  },

  /** 範囲を選択したところ */
  async range({ base, out }) {
    const b = await openApp(base)
    await b.drag(383, 300, 703, 300)
    await sleep(800)
    await b.park()
    await b.shot(out('range.png'), { x: 0, y: 0, width: 1440, height: 400 })
    b.close()
  },
}
