// ヘッドレスの Chrome を DevTools Protocol（CDP）で動かす小さな道具。docs の画像の撮影に使う（run.mjs）
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Chrome の場所。環境変数 CHROME で指定できる */
function chromePath() {
  const candidates = [
    process.env.CHROME,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ]
  const found = candidates.find((p) => p && existsSync(p))
  if (!found) throw new Error('Chrome が見つからない。環境変数 CHROME で場所を指定する')
  return found
}

let nextPort = 9400

/**
 * Chrome を開く。`mobile` ならタッチの端末として扱う。
 * 戻り値の関数: call（CDP の命令）、evaluate（ページで式を実行）、マウスとタッチの操作、shot（撮影）、close
 */
export async function launch({ width = 1440, height = 860, mobile = false, scale = 1 } = {}) {
  const port = nextPort++
  const profile = mkdtempSync(join(tmpdir(), 'wvs-shot-'))
  const chrome = spawn(chromePath(), ['--headless=new', `--window-size=${width},${height}`, `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--hide-scrollbars', 'about:blank'])
  let list = null
  for (let i = 0; i < 50 && !list; i++) {
    await sleep(200)
    list = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json(), () => null)
  }
  if (!list) throw new Error('Chrome に接続できない')
  const ws = new WebSocket(list.find((x) => x.type === 'page').webSocketDebuggerUrl)
  await new Promise((r) => (ws.onopen = r))
  let id = 0
  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const i = ++id
      const onMessage = (e) => {
        const m = JSON.parse(e.data)
        if (m.id !== i) return
        ws.removeEventListener('message', onMessage)
        if (m.error) reject(new Error(`${method}: ${m.error.message}`))
        else resolve(m.result)
      }
      ws.addEventListener('message', onMessage)
      ws.send(JSON.stringify({ id: i, method, params }))
    })
  await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile })
  if (mobile) await call('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  await call('Page.enable')

  const evaluate = async (expression) => {
    const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
    return r.result.value
  }
  const mouse = (type, x, y, extra = {}) => call('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, ...extra })
  const touch = (type, points) => call('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y]) => ({ x, y })) })
  return {
    call,
    evaluate,
    mouse,
    /** 左ボタンでドラッグする（10 段に分けて動かす） */
    async drag(x0, y0, x1, y1, steps = 10) {
      await mouse('mousePressed', x0, y0)
      for (let k = 1; k <= steps; k++) await mouse('mouseMoved', x0 + ((x1 - x0) * k) / steps, y0 + ((y1 - y0) * k) / steps, { buttons: 1 })
      await mouse('mouseReleased', x1, y1)
    },
    async click(x, y) {
      await mouse('mousePressed', x, y)
      await mouse('mouseReleased', x, y)
    },
    async rightClick(x, y) {
      await mouse('mousePressed', x, y, { button: 'right' })
      await mouse('mouseReleased', x, y, { button: 'right' })
    },
    /** 指でなぞる */
    async swipe(x0, y0, x1, y1, steps = 10) {
      await touch('touchStart', [[x0, y0]])
      for (let k = 1; k <= steps; k++) {
        await touch('touchMove', [[x0 + ((x1 - x0) * k) / steps, y0 + ((y1 - y0) * k) / steps]])
        await sleep(16)
      }
      await touch('touchEnd', [])
    },
    async tap(x, y) {
      await touch('touchStart', [[x, y]])
      await touch('touchEnd', [])
    },
    /** 撮影して `file` に書く。`clip` は CSS の座標 */
    async shot(file, clip) {
      const s = await call('Page.captureScreenshot', clip ? { clip: { ...clip, scale: 1 } } : {})
      writeFileSync(file, Buffer.from(s.data, 'base64'))
    },
    close() {
      chrome.kill()
      // Chrome が手放すまで少し待ってから消す（消せなくても続ける）
      setTimeout(() => rmSync(profile, { recursive: true, force: true }), 1000)
    },
  }
}
