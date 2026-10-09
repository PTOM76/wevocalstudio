// アプリの定義。vite.config.ts からも読み込むので、ほかのファイルを import しない（画面からは appConfig.ts の app を使う）
export const APP_INFO = {
  // 保存のキーの接頭辞。公開したあとに変えると、保存済みの設定が読めなくなる
  id: 'wevocalstudio',
  name: 'WeVocal Studio',
  description: 'A browser-based DAW for arranging and editing audio',
  author: 'PitaQ',
  repository: 'https://github.com/PTOM76/wevocalstudio',
  // OGP の絶対 URL（ビルド時は SITE_URL が優先）
  site: 'https://example.com/',
  // <html lang> と og:locale
  lang: 'ja_jp',
}
