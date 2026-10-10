import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
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
// WeVocalAnalyzer のライブラリ（スペクトログラム、F0。src/ は画面を持たない）。WeVocalSynth の中の analyzer/ を使う
const analyzer = submodule('analyzer', 'src/index.ts', process.env.ANALYZER_PATH)
// WeVocalExtractor（ボーカル抽出）。本体は追加機能として配り、アプリは手順（src/host.ts）だけを使う
const extractor = submodule('extractor', 'src/host.ts', process.env.EXTRACTOR_PATH)
// 場所が決まるのは実行時なので、動的に読み込む（Node が .ts の型を取り除いて読む）
const { pevenAddonsRoute, pevenApp, pevenManifest }: typeof import('./pevenmui/src/vite.ts') = await import(pathToFileURL(resolve(pevenmui, 'src/vite.ts')).href)

export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  resolve: {
    alias: [
      { find: /^pevenmui$/, replacement: resolve(pevenmui, 'src/index.ts') },
      { find: /^pevenmui\/web$/, replacement: resolve(pevenmui, 'src/web/index.ts') },
      { find: /^pevenmui\/pwa$/, replacement: resolve(pevenmui, 'src/pwa/index.ts') },
      { find: /^pevenmui\/debug$/, replacement: resolve(pevenmui, 'src/debug/index.ts') },
      { find: /^wevocalextractor\/host$/, replacement: resolve(extractor, 'src/host.ts') },
      { find: /^wevocalanalyzer$/, replacement: resolve(analyzer, 'src/index.ts') },
      { find: /^wevocal-lib\/react$/, replacement: resolve(wevocalLib, 'web/src/react/index.ts') },
      { find: /^wevocal-lib$/, replacement: resolve(wevocalLib, 'web/src/index.ts') },
    ],
    // 外にある pevenmui から読み込む React、MUI も、このアプリと同じものにする（2 つになると動かない）
    dedupe: ['react', 'react-dom', '@mui/material', '@emotion/react', '@emotion/styled', '@fortawesome/react-fontawesome'],
  },
  server: { fs: { allow: [root, pevenmui, wevocalLib, analyzer, extractor, resolve(pevenmui, '..')] } },
  // 版（__APP_VERSION__、__APP_COMMIT__、version.json）と、index.html の名前、言語、配信先の URL
  plugins: [
    react(),
    pevenApp(APP_INFO, { version: pkg.version, root }),
    // PWA（WeVocalAnalyzer と同じ）。新しい版は利用者が「更新」を押したときに切り替える
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        ...pevenManifest(APP_INFO),
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#ffffff',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
        // インストールした PWA を .wvstudio を開くアプリとして登録する（音声ファイルは登録しない。WeVocalSynth と同じ）。受け取りは src/useProjectFile.ts の launchQueue
        file_handlers: [{ action: './', accept: { 'application/x-wevocalstudio-project': ['.wvstudio'] } }],
        launch_handler: { client_mode: 'focus-existing' },
      },
      workbox: {
        inlineWorkboxRuntime: true,
        // 更新で切り替わったときに、名前の違う古い版のキャッシュを消す
        cleanupOutdatedCaches: true,
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2,wasm}'],
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
        // 追加機能はアプリ本体のプリキャッシュに入れず、導入した人だけ別のキャッシュに保存する（WeVocalSynth と同じ）
        globIgnores: ['addons/**'],
        // 追加機能のページ（addons/ 以下）を開いたときにアプリ本体の index.html を返さない
        navigateFallbackDenylist: [/\/addons\//],
        // 追加機能のファイルを保存先から返す（保存先の名前は app.id から決まる。pevenmui/src/addons/store.ts）
        runtimeCaching: [pevenAddonsRoute(APP_INFO.id)],
      },
    }),
  ],
})
