import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import pkg from './package.json' with { type: 'json' }
import { APP_INFO } from './src/appInfo.ts'

const root = dirname(fileURLToPath(import.meta.url))

/** submodule（`name/`）の場所。`env` を指定するか、隣の WeVocalSynth の中にあればそちらを使い（両方を直しながら開発できるように）、なければ自分の submodule */
function submodule(name: string, entry: string, env: string | undefined) {
  const synth = resolve(root, '../wevocalsynth', name)
  return env ?? (existsSync(resolve(synth, entry)) ? synth : resolve(root, name))
}
// PevenMUI（画面の部品）と wevocal-lib（音声の読み込み、書き出し。TypeScript 側は web/）
const pevenmui = submodule('pevenmui', 'src/index.ts', process.env.PEVENMUI_PATH)
const wevocalLib = submodule('wevocal-lib', 'web/src/index.ts', process.env.WEVOCAL_LIB_PATH)
// 場所が決まるのは実行時なので、動的に読み込む（Node が .ts の型を取り除いて読む）
const { pevenApp }: typeof import('../wevocalsynth/pevenmui/src/vite.ts') = await import(pathToFileURL(resolve(pevenmui, 'src/vite.ts')).href)

export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  resolve: {
    alias: [
      { find: /^pevenmui$/, replacement: resolve(pevenmui, 'src/index.ts') },
      { find: /^pevenmui\/web$/, replacement: resolve(pevenmui, 'src/web/index.ts') },
      { find: /^wevocal-lib$/, replacement: resolve(wevocalLib, 'web/src/index.ts') },
    ],
    // 外にある pevenmui から読み込む React、MUI も、このアプリと同じものにする（2 つになると動かない）
    dedupe: ['react', 'react-dom', '@mui/material', '@emotion/react', '@emotion/styled', '@fortawesome/react-fontawesome'],
  },
  server: { fs: { allow: [root, pevenmui, wevocalLib, resolve(pevenmui, '..')] } },
  // 版（__APP_VERSION__、__APP_COMMIT__、version.json）と、index.html の名前、言語、配信先の URL
  plugins: [react(), pevenApp(APP_INFO, { version: pkg.version, root })],
})
