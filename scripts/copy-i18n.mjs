// WeVocalSynth の訳文から、Studio にないキーを写す（node scripts/copy-i18n.mjs <key>...）。Studio は ja_jp と en_us だけ
import fs from 'node:fs'
const SYNTH = '../wevocalsynth/src/i18n'
for (const lang of ['ja_jp', 'en_us']) {
  const src = JSON.parse(fs.readFileSync(`${SYNTH}/${lang}.json`, 'utf8'))
  const file = `src/lang/${lang}.json`
  const dst = JSON.parse(fs.readFileSync(file, 'utf8'))
  for (const k of process.argv.slice(2)) {
    if (k in dst) continue
    if (!(k in src)) console.warn(`${lang}: ${k} は Synth にない`)
    else dst[k] = src[k]
  }
  fs.writeFileSync(file, JSON.stringify(dst, null, 2) + '\n')
}
