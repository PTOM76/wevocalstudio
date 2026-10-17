// submodule（pevenmui、wevocal-lib、analyzer、extractor、converter）を、隣の WeVocalSynth の中の今のコミットにそろえる（GitHub Actions は submodule でビルドするため）。
// コミットの前（.githooks/pre-commit）と npm install のあとに自動で動く。submodule にはコミットを止めるフック（.githooks/submodule）を入れ、
// Studio の側にしかない変更やコミットがあれば止める（上書きして消さない）。--check は push の前（.githooks/pre-push）に、指しているコミットが GitHub にあるかを確かめる
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const MODULES = ['pevenmui', 'wevocal-lib', 'analyzer', 'extractor', 'converter']
// フックの中では git が GIT_INDEX_FILE などを入れるので、submodule の git に渡さない
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')))
const git = (cwd, ...args) => execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
// 成功したか（merge-base --is-ancestor のように、終了コードで答えるもの。コミットが無ければ false）
const ok = (cwd, ...args) => {
  try {
    git(cwd, ...args)
    return true
  } catch {
    return false
  }
}

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

const errors = []
for (const name of MODULES) {
  if (!existsSync(resolve(name, '.git'))) continue
  // Studio の中の submodule ではコミットさせない
  git(name, 'config', 'core.hooksPath', resolve('.githooks/submodule'))
  const sibling = resolve(`../wevocalsynth/${name}`)
  if (!existsSync(sibling)) continue
  const sha = git(sibling, 'rev-parse', 'HEAD')
  const here = git(name, 'rev-parse', 'HEAD')
  if (here === sha) continue
  // Studio の中で書き換えたままのものや、隣にないコミットは、そろえると消えるので止める
  if (git(name, 'status', '--porcelain', '--untracked-files=no')) {
    errors.push(`${name} に Studio の中で書き換えた所があります。../wevocalsynth/${name} に移してから、ここの変更を戻してください`)
    continue
  }
  if (!ok(sibling, 'merge-base', '--is-ancestor', here, sha)) {
    errors.push(`${name} の ${here.slice(0, 7)} が ../wevocalsynth/${name} の今のコミットに含まれていません。隣に取り込んでからコミットしてください`)
    continue
  }
  // push 前のコミットでもそろえられるよう、隣の中から直接取る
  git(name, 'fetch', '-q', sibling, sha)
  git(name, 'checkout', '-q', sha)
  console.log(`${name} -> ${sha.slice(0, 7)}`)
}
if (errors.length) {
  console.error(errors.join('\n'))
  process.exit(1)
}
