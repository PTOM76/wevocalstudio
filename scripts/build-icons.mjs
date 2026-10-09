// public/icon.svg から PWA のアイコンの PNG を作る（ヘッドレスの Chrome で描く。WeVocalSynth の scripts/screenshots/cdp.mjs を使う）
import { readFileSync } from 'node:fs'
import { launch, sleep } from '../../wevocalsynth/scripts/screenshots/cdp.mjs'
// Chrome を閉じたあとの一時フォルダーの片付けが、使用中で失敗することがある（PNG はできているので無視する）
process.on('uncaughtException', (e) => {
  if (e.code !== 'EBUSY') throw e
})
const svg = readFileSync('public/icon.svg', 'utf8')
const out = 'public/'
const shots = [
  ['icon-192.png', 192, 0, 96],
  ['icon-512.png', 512, 0, 96],
  ['apple-touch-icon.png', 180, 0, 0],
  ['icon-maskable-192.png', 192, 0.1, 0],
  ['icon-maskable-512.png', 512, 0.1, 0],
]
for (const [name, size, pad, rx] of shots) {
  const b = await launch({ width: size, height: size })
  // マスク用と apple は角を丸めず、塗りを全面に広げる
  const body = rx ? svg : svg.replace('rx="96"', 'rx="0"')
  const inner = size * (1 - pad * 2)
  const html = `<html><body style="margin:0;background:${rx ? 'transparent' : '#1976d2'}"><div style="width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center">${body.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div></body></html>`
  await b.call('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } })
  await b.call('Page.navigate', { url: 'data:text/html;base64,' + Buffer.from(html).toString('base64') })
  await sleep(500)
  await b.shot(out + name)
  b.close()
}
console.log('ok')
