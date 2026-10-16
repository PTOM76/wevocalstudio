// MANUAL.md の目次（「## 目次」の節）を、見出し（## と ###）から作る。コードの囲みの中の見出しは数えない
// 使い方: node scripts/manual-toc.mjs [--write] [ファイル（既定 docs/MANUAL.md）]
//   --write を省くと、今の目次との違いを表示するだけ（違いがあれば終了コード 1）
import { readFileSync, writeFileSync } from 'node:fs'

const args = process.argv.slice(2)
const write = args.includes('--write')
const file = args.find((a) => !a.startsWith('--')) ?? 'docs/MANUAL.md'
const text = readFileSync(file, 'utf8')
const eol = text.includes('\r\n') ? '\r\n' : '\n'
const lines = text.replace(/\r\n/g, '\n').split('\n')

/** 見出しの文字からリンクの名前を作る（GitHub と同じ。記号を除き、空白を - にし、重なったら -1、-2 を付ける） */
const seen = new Map()
const slug = (title) => {
  const base = title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/\s/g, '-')
  const n = seen.get(base) ?? 0
  seen.set(base, n + 1)
  return n ? `${base}-${n}` : base
}

// 見出しを集める
const heads = []
let fence = false
for (const [i, line] of lines.entries()) {
  if (/^```/.test(line)) fence = !fence
  const m = !fence && /^(#{2,3}) (.+)$/.exec(line)
  if (m) heads.push({ line: i, level: m[1].length, title: m[2].trim(), id: slug(m[2].trim()) })
}

const tocAt = heads.find((h) => h.level === 2 && h.title === '目次')
if (!tocAt) {
  console.error(`${file}: 「## 目次」の見出しがありません`)
  process.exit(2)
}
// 目次の節は、次の ## の手前まで（空行を含む）
const next = heads.find((h) => h.level === 2 && h.line > tocAt.line)
const end = next ? next.line : lines.length

const body = heads
  .filter((h) => h.line > tocAt.line && h !== tocAt)
  .map((h) => `${h.level === 3 ? '  ' : ''}- [${h.title}](#${h.id})`)
const made = ['## 目次', '', ...body, '']
const old = lines.slice(tocAt.line, end)

if (made.join('\n') === old.join('\n')) {
  console.log(`${file}: 目次は見出しと一致しています`)
  process.exit(0)
}
if (!write) {
  const o = new Set(old)
  const n = new Set(made)
  for (const l of old) if (!n.has(l) && l.trim()) console.log(`- ${l}`)
  for (const l of made) if (!o.has(l) && l.trim()) console.log(`+ ${l}`)
  console.log(`${file}: 目次が見出しと違います（node scripts/manual-toc.mjs --write で直します）`)
  process.exit(1)
}
lines.splice(tocAt.line, end - tocAt.line, ...made)
writeFileSync(file, lines.join('\n').replace(/\n/g, eol))
console.log(`${file}: 目次を書き直しました（${body.length} 項目）`)
