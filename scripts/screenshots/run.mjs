// docs/images の画面の画像を撮り直す。開発サーバーを立て、ヘッドレスの Chrome でアプリを操作して撮る
// 使い方: npm run docs:shots [-- 名前...]（名前は shots.mjs の SHOTS のキー。省くと全部）
// 追加機能の画面を撮るときは、先に npm run build:addons:dev を実行しておく
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { SHOTS } from './shots.mjs'

const PORT = 5197
const BASE = `http://localhost:${PORT}/`
const OUT = 'docs/images'

const names = process.argv.slice(2)
const unknown = names.filter((n) => !SHOTS[n])
if (unknown.length) {
  console.error(`知らない名前: ${unknown.join(', ')}（${Object.keys(SHOTS).join(', ')}）`)
  process.exit(1)
}
if (!existsSync('public/addons/converter/manifest.json') || !existsSync('public/addons/analyzer/manifest.json')) {
  console.warn('public/addons に追加機能がない。追加機能の画面は撮れないので、先に npm run build:addons:dev を実行する')
}

const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { shell: true, stdio: 'ignore' })
const stop = () => {
  // Windows では npx の子のプロセスまで止める
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(vite.pid), '/T', '/F'])
  else vite.kill()
}
try {
  for (let i = 0; ; i++) {
    if (await fetch(BASE).then((r) => r.ok, () => false)) break
    if (i > 100) throw new Error('開発サーバーが起動しない')
    await new Promise((r) => setTimeout(r, 300))
  }
  for (const name of names.length ? names : Object.keys(SHOTS)) {
    process.stdout.write(`${name} … `)
    const started = Date.now()
    await SHOTS[name]({ base: BASE, out: (file) => join(OUT, file) })
    console.log(`${((Date.now() - started) / 1000).toFixed(1)}s`)
  }
} finally {
  stop()
}
process.exit(0)
