// WeVocalSynth を開いて操作する道具（撮影の手順は shots.mjs）
import { launch, sleep } from './cdp.mjs'

export { sleep }

/**
 * 撮影用のメロディ（既定は melody.wav、8.95 秒、ビブラート付きの声のような音）を作って、画面にドロップする式。
 * 実在の曲を使わないため、音はここで作る
 */
export const dropMelody = (name = 'melody.wav', transpose = 0) => `(async () => {
  const sr = 44100
  const notes = [[67, 0.0, 0.55], [69, 0.6, 0.5], [71, 1.15, 0.9], [74, 2.4, 0.55], [72, 3.0, 0.5], [69, 3.55, 0.9], [64, 4.8, 0.55], [62, 5.4, 0.5], [60, 5.95, 0.9], [67, 7.2, 0.45], [71, 7.7, 1.1]]
  const len = Math.round(sr * 8.95)
  const d = new Float32Array(len)
  for (const [m, t0, dur] of notes) {
    const f0 = 440 * 2 ** ((m + ${transpose} - 69) / 12)
    const s0 = Math.round(t0 * sr)
    const n = Math.round(dur * sr)
    let ph = 0
    for (let i = 0; i < n && s0 + i < len; i++) {
      const t = i / sr
      const vib = t > 0.15 ? 0.35 * Math.sin(2 * Math.PI * 5.5 * t) : 0
      ph += (2 * Math.PI * f0 * 2 ** (vib / 12)) / sr
      const env = Math.min(1, i / 2000, (n - i) / 3000)
      let v = 0
      for (let k = 1; k <= 8; k++) v += (Math.sin(k * ph) / k) * (k === 2 || k === 3 ? 1.3 : 1)
      d[s0 + i] += 0.13 * env * v
    }
  }
  const buf = new ArrayBuffer(44 + len * 2)
  const dv = new DataView(buf)
  const w = (o, s) => [...s].forEach((c, i) => dv.setUint8(o + i, c.charCodeAt(0)))
  w(0, 'RIFF'); dv.setUint32(4, 36 + len * 2, true); w(8, 'WAVEfmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true)
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); w(36, 'data'); dv.setUint32(40, len * 2, true)
  for (let i = 0; i < len; i++) dv.setInt16(44 + i * 2, Math.max(-1, Math.min(1, d[i])) * 32767, true)
  const dt = new DataTransfer()
  dt.items.add(new File([buf], ${JSON.stringify(name)}, { type: 'audio/wav' }))
  window.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }))
  window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
})()`

/**
 * 追加機能 `ids` を導入済みに見せる。ヘッドレスの Chrome では Cache Storage に保存できないため、
 * マニフェストだけ配信中のもの（public/addons/。npm run build:addons:dev で作る）を返す。本体は配信中のものを読み込む
 */
const fakeAddons = (ids) => `(() => {
  const ids = ${JSON.stringify(ids)}
  const open = caches.open.bind(caches)
  caches.open = async (name) => {
    const c = await open(name)
    const match = c.match.bind(c)
    c.match = async (req, o) => {
      const u = typeof req === 'string' ? req : req.url
      if (ids.some((id) => u.includes('/addons/' + id + '/manifest.json'))) return fetch(u + '?t=' + Date.now())
      return match(req, o)
    }
    return c
  }
})()`

/**
 * 手元（public/addons）にないモデルの大きさ（MB。docs/EXTRACTOR.md の表）。設定の「追加機能」の画面で
 * 「配信先から情報を取得できません」と写らないよう、マニフェストが無いときだけこの大きさの仮のものを返す
 */
const MODEL_MB = { 'spleeter-fp16': 38, 'spleeter-int8': 50, 'spleeter-fp32': 75, 'uvr-mdx-voc-ft': 64, 'uvr-mdx-inst-hq4': 64, 'uvr-mdx-kara2': 53 }
const fakeManifests = `(() => {
  const sizes = ${JSON.stringify(MODEL_MB)}
  const fetch0 = window.fetch.bind(window)
  window.fetch = async (input, init) => {
    const res = await fetch0(input, init)
    const m = String(input.url ?? input).match(/\\/addons\\/([^/]+)\\/manifest\\.json/)
    if (!m || !sizes[m[1]]) return res
    // 開発サーバーは、無いファイルにも index.html を返す
    if (res.ok && (res.headers.get('content-type') ?? '').includes('json')) return res
    const files = [{ path: 'model.onnx', size: sizes[m[1]] * 2 ** 20, sha256: '' }]
    return new Response(JSON.stringify({ id: m[1], version: 'shot', entry: null, files }), { headers: { 'content-type': 'application/json' } })
  }
})()`

/**
 * アプリを開く。
 * - `settings`: 設定の一部を先に入れておく（テーマ、スマホの画面など）
 * - `addons`: 導入済みに見せる追加機能
 * - `open`: メロディを開く（既定は true）
 */
export async function openApp(base, { settings, addons, open = true, ...view } = {}) {
  const b = helpers(await launch(view))
  if (addons?.length) await b.call('Page.addScriptToEvaluateOnNewDocument', { source: fakeAddons(addons) })
  await b.call('Page.addScriptToEvaluateOnNewDocument', { source: fakeManifests })
  // 起動時の案内や更新の通知が写らないよう、設定を先に入れる
  const s = { language: 'ja_jp', dialogWindow: 'dialog', ...settings }
  await b.call('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('wevocalsynth.settings', JSON.stringify(Object.assign(JSON.parse(localStorage.getItem('wevocalsynth.settings') || '{}'), ${JSON.stringify(s)})))` })
  await b.call('Page.navigate', { url: base })
  await b.waitFor(`!!document.querySelector('header, [role=menubar]')`)
  await sleep(1500)
  if (open) {
    await b.evaluate(dropMelody())
    await b.waitFor(`document.querySelectorAll('canvas').length > 0`)
    await sleep(4000)
    await b.dismissToasts()
  }
  return b
}

/** ページの道具を b に足す（launch の戻り値に足して使う） */
function helpers(b) {
  /** `cond`（式）が真になるまで待つ */
  b.waitFor = async (cond, timeout = 20000) => {
    const end = Date.now() + timeout
    while (Date.now() < end) {
      if (await b.evaluate(`(() => { try { return !!(${cond}) } catch { return false } })()`)) return
      await sleep(200)
    }
    throw new Error(`待ちきれなかった: ${cond}`)
  }
  /** 文字で始まるボタンやメニューの項目をクリックする */
  b.clickText = async (text) => {
    const r = await b.evaluate(`(() => {
      const el = [...document.querySelectorAll('button, [role=menuitem], [role=tab], [role=option], li')].find((e) => e.offsetParent !== null && e.textContent.trim().startsWith(${JSON.stringify(text)}))
      if (!el) return false
      el.click()
      return true
    })()`)
    if (!r) throw new Error(`見つからない: ${text}`)
    await sleep(500)
  }
  /** aria-label（ボタンの名前）を含むボタンをクリックする。`last` なら最後に見つかったもの（同じ名前のボタンが複数あるとき） */
  b.clickLabel = async (label, last = false) => {
    const r = await b.evaluate(`(() => {
      const all = [...document.querySelectorAll('button')].filter((e) => (e.getAttribute('aria-label') ?? '').includes(${JSON.stringify(label)}) && e.getBoundingClientRect().width > 0)
      const el = ${last} ? all.pop() : all[0]
      if (!el) return false
      el.click()
      return true
    })()`)
    if (!r) throw new Error(`見つからない: ${label}`)
    await sleep(500)
  }
  /** 要素の位置（式は要素を返す） */
  b.rect = async (expr) => {
    const r = await b.evaluate(`(() => { const e = (${expr}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })()`)
    if (!r) throw new Error(`要素が見つからない: ${expr.slice(0, 160)}`)
    return r
  }
  /** aria-label を含むボタンの位置 */
  b.labelRect = (label) => b.rect(`[...document.querySelectorAll('button')].find((e) => (e.getAttribute('aria-label') ?? '').includes(${JSON.stringify(label)}))`)
  /**
   * 番号の丸（docs の _with_note の画像の印）を重ねる。白い縁取りの赤い丸に白い数字。
   * `items` は [番号, x, y]（丸の中心、CSS の座標）。`size` は丸の直径（CSS の px）
   */
  b.note = (items, size = 20) =>
    b.evaluate(`(() => {
      const size = ${size}
      for (const [n, x, y] of ${JSON.stringify(items)}) {
        const el = document.createElement('div')
        el.className = 'shot-note'
        el.textContent = n
        Object.assign(el.style, { position: 'fixed', left: (x - size / 2) + 'px', top: (y - size / 2) + 'px', width: size + 'px', height: size + 'px', boxSizing: 'border-box', borderRadius: '50%', background: '#e53935', border: (size * 0.075) + 'px solid #fff', color: '#fff', font: 'bold ' + Math.round(size * 0.55) + 'px Arial, sans-serif', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 99999, pointerEvents: 'none' })
        document.body.append(el)
      }
    })()`)
  /** 重ねたものを消す */
  b.clearNotes = () => b.evaluate(`document.querySelectorAll('.shot-note, .shot-cover').forEach((e) => e.remove())`)
  /** 通知（テンポの解析など）が消えるまで少し待ち、残っていれば取り除く */
  b.dismissToasts = async () => {
    const has = `document.querySelector('.MuiSnackbar-root')`
    for (let i = 0; i < 20 && (await b.evaluate(`!!${has}`)); i++) await sleep(300)
    await b.evaluate(`document.querySelectorAll('.MuiSnackbar-root').forEach((e) => e.remove())`)
  }
  /** マウスを画面の隅に置く（ツールチップやホバーの色が写らないように） */
  b.park = async () => {
    await b.mouse('mouseMoved', 1, 1)
    await sleep(400)
  }
  return b
}

/** アプリを開かずに Chrome だけを開く */
export async function launchBlank(view) {
  return helpers(await launch(view))
}
