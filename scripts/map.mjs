#!/usr/bin/env node
// コードの地図: 各ファイルの 1 行目の説明を、フォルダーごとに並べて表示する（どこを開けばよいかを探すため）
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const usage = `使い方: node scripts/map.mjs [フォルダー...] [--check] [--write]

  フォルダーを省くと src と dsp/src
  --check  1 行目に説明のないファイルを表示する（あれば終了コード 1）
  --write  docs/STRUCTURE.md の <!-- map:start --> と <!-- map:end --> の間を書き換える
  --cochange [件数]  直近の 300 コミットで、よく一緒に変わるファイルの組を表示する（既定 20 組）。
           一緒に変わるのに別の場所にあるものは、まとめるか、決め事を 1 か所に隠す候補`

const args = process.argv.slice(2)
if (args.includes('--help')) {
  console.log(usage)
  process.exit(0)
}

// 一緒に変わるファイルの組（論理的な結合。Gall らの考え方）
if (args.includes('--cochange')) {
  const limit = Number(args[args.indexOf('--cochange') + 1]) || 20
  const log = execFileSync('git', ['log', '--no-merges', '-n', '300', '--name-only', '--pretty=format:@@'], { encoding: 'utf8' })
  const changes = new Map()
  const pairs = new Map()
  for (const block of log.split('@@')) {
    // ソースだけを見る。訳文の JSON はいつも一緒に変わるので除く
    const files = [...new Set(block.split('\n').map((l) => l.trim()).filter((f) => /^(src|dsp\/src)\/.*\.(ts|tsx|rs)$/.test(f)))]
    // 整形や一括のリファクタリング（多くのファイルを一度に変えたもの）は数えない
    if (files.length < 2 || files.length > 15) {
      files.forEach((f) => changes.set(f, (changes.get(f) ?? 0) + 1))
      continue
    }
    files.forEach((f) => changes.set(f, (changes.get(f) ?? 0) + 1))
    files.sort()
    for (let i = 0; i < files.length; i++) for (let j = i + 1; j < files.length; j++) {
      const k = `${files[i]}\t${files[j]}`
      pairs.set(k, (pairs.get(k) ?? 0) + 1)
    }
  }
  const rows = [...pairs]
    .filter(([, n]) => n >= 3)
    .map(([k, n]) => {
      const [a, b] = k.split('\t')
      // 変わる回数の少ない方が変わったとき、もう片方も変わる割合
      return { a, b, n, rate: n / Math.min(changes.get(a), changes.get(b)) }
    })
    .sort((x, y) => y.n * y.rate - x.n * x.rate)
    .slice(0, limit)
  console.log('回数  割合  ファイルの組')
  for (const r of rows) console.log(`${String(r.n).padStart(4)}  ${`${Math.round(r.rate * 100)}%`.padStart(4)}  ${r.a}  ${r.b}`)
  process.exit(0)
}
const roots = args.filter((a) => !a.startsWith('--'))
const dirs = roots.length ? roots : ['src', 'dsp/src']
const EXT = /\.(ts|tsx|rs|mjs)$/

/** `dir` の下のソースファイル（そのフォルダーのファイルを名前の順に並べてから、サブフォルダー） */
function walk(dir) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.name !== 'node_modules' && !e.name.startsWith('.'))
  } catch {
    // 消している途中などで読めないフォルダーは飛ばす
    return []
  }
  const byName = (a, b) => a.name.localeCompare(b.name)
  const files = entries.filter((e) => e.isFile() && EXT.test(e.name) && !e.name.endsWith('.d.ts')).sort(byName)
  const subdirs = entries.filter((e) => e.isDirectory()).sort(byName)
  return [...files.map((e) => path.join(dir, e.name).replaceAll('\\', '/')), ...subdirs.flatMap((e) => walk(path.join(dir, e.name)))]
}

/** 説明（最初の行の `// …`、`//! …`、または `/** …` の最初の文）。なければ null */
function header(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n').map((l) => l.trim())
  const i = lines.findIndex((l) => l)
  const first = lines[i] ?? ''
  if (/^\/\/!?/.test(first)) return first.replace(/^\/\/!?\s*/, '')
  if (!first.startsWith('/**')) return null
  // 複数行の doc コメントは、最初の中身の行
  const text = first === '/**' ? (lines[i + 1] ?? '').replace(/^\*\s?/, '') : first.replace(/^\/\*\*\s*/, '')
  return text.replace(/\s*\*\/$/, '') || null
}

const files = dirs.flatMap(walk)
const lines = []
const missing = []
let current = ''
for (const f of files) {
  const dir = path.posix.dirname(f)
  if (dir !== current) {
    current = dir
    lines.push(`\n${dir}/`)
  }
  const h = header(f)
  if (h === null) missing.push(f)
  lines.push(`  ${path.posix.basename(f)}  ${h ?? '（説明なし）'}`)
}
const text = lines.join('\n').trim()

if (args.includes('--check')) {
  if (missing.length) console.log(`1 行目に説明のないファイル ${missing.length} 件:\n  ${missing.join('\n  ')}`)
  else console.log(`すべてのファイルに説明がある（${files.length} ファイル）`)
  process.exitCode = missing.length ? 1 : 0
} else if (args.includes('--write')) {
  const doc = 'docs/STRUCTURE.md'
  const s = fs.readFileSync(doc, 'utf8')
  const start = '<!-- map:start -->'
  const end = '<!-- map:end -->'
  const a = s.indexOf(start)
  const b = s.indexOf(end)
  if (a < 0 || b < a) throw new Error(`${doc} に ${start} と ${end} がない`)
  fs.writeFileSync(doc, `${s.slice(0, a + start.length)}\n\`\`\`\n${text}\n\`\`\`\n${s.slice(b)}`)
  console.log(`${doc} を書き換えた（${files.length} ファイル）`)
} else {
  console.log(text)
}
