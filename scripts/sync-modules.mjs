// submodule（pevenmui、wevocal-lib、analyzer）を、隣の WeVocalSynth の中の今のコミットにそろえる（GitHub Actions は submodule でビルドするため）
import { execFileSync } from 'node:child_process'

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
for (const name of ['pevenmui', 'wevocal-lib', 'analyzer']) {
  const sha = git(`../wevocalsynth/${name}`, 'rev-parse', 'HEAD')
  git(name, 'fetch', '-q', 'origin')
  git(name, 'checkout', '-q', sha)
  console.log(`${name} -> ${sha.slice(0, 7)}`)
}
console.log('git add pevenmui wevocal-lib analyzer でコミットする（先に Synth の中のものを push しておく）')
