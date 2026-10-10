// submodule（pevenmui、wevocal-lib、analyzer、extractor）を、隣の WeVocalSynth の中の今のコミットにそろえる（GitHub Actions は submodule でビルドするため）。
// コミットの前（.githooks/pre-commit）に自動で動く。--check は push の前（.githooks/pre-push）に、指しているコミットが GitHub にあるかを確かめる
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const MODULES = ['pevenmui', 'wevocal-lib', 'analyzer', 'extractor']
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

if (process.argv.includes('--check')) {
  // 指しているコミットが、それぞれの GitHub（origin）にあるか
  const missing = []
  for (const name of MODULES) {
    const sha = git('.', 'rev-parse', `HEAD:${name}`)
    git(name, 'fetch', '-q', 'origin')
    if (!git(name, 'branch', '-r', '--contains', sha)) missing.push(`${name}（${sha.slice(0, 7)}）`)
  }
  if (missing.length) {
    console.error(`まだ GitHub にないコミットを指しています。先に WeVocalSynth の中の ${missing.join('、')} を push してください`)
    process.exit(1)
  }
  process.exit(0)
}

for (const name of MODULES) {
  const sibling = resolve(`../wevocalsynth/${name}`)
  if (!existsSync(sibling)) continue
  const sha = git(sibling, 'rev-parse', 'HEAD')
  // push 前のコミットでもそろえられるよう、隣の中から直接取る
  if (git(name, 'rev-parse', 'HEAD') !== sha) {
    git(name, 'fetch', '-q', sibling, sha)
    git(name, 'checkout', '-q', sha)
    console.log(`${name} -> ${sha.slice(0, 7)}`)
  }
}
