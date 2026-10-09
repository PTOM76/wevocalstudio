// Rust の DSP クレートを wasm にビルドし、src/dsp にコピーする
import { execSync } from 'node:child_process'
import { copyFileSync } from 'node:fs'

execSync('cargo build --release --target wasm32-unknown-unknown', { cwd: 'dsp', stdio: 'inherit' })
copyFileSync('dsp/target/wasm32-unknown-unknown/release/wevocalstudio_dsp.wasm', 'src/dsp/dsp.wasm')
console.log('wasm -> src/dsp/dsp.wasm')
