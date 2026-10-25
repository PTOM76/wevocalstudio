import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// テストは React と音声の入出力を使わない純粋な関数だけを対象にする（ブラウザの機能は要らない）。wevocal-lib の分も隣の WeVocalSynth の中から動かす
export default defineConfig({
  resolve: {
    alias: [
      { find: /^wevocal-lib\/stream$/, replacement: resolve(import.meta.dirname, '../wevocalsynth/wevocal-lib/web/src/plugins/stream/index.ts') },
      { find: /^wevocal-lib$/, replacement: resolve(import.meta.dirname, '../wevocalsynth/wevocal-lib/web/src/index.ts') },
      { find: /^pevenmui\/debug$/, replacement: resolve(import.meta.dirname, '../wevocalsynth/pevenmui/src/debug/index.ts') },
    ],
  },
  test: {
    environment: 'node',
    setupFiles: ['src/test/setup.ts'],
    include: ['src/**/*.test.ts', '../wevocalsynth/wevocal-lib/web/src/**/*.test.ts', '../wevocalsynth/pevenmui/src/**/*.test.ts'],
  },
})
