// アプリの定義。vite.config.ts からも読み込むので、ほかのファイルを import しない（画面からは appConfig.ts の app を使う）
export const APP_INFO = {
  id: 'wevocalstudio', // アプリの識別子(保存のキーの接頭辞)
  name: 'WeVocal Studio',
  description: 'Webブラウザ上でトラックにブロックとして音声やMIDIなどを並べて編集する総合音声ツール(DAW)',
  author: 'PitaQ',
  repository: 'https://github.com/PTOM76/wevocalstudio',
  site: 'https://wevocalstudio.pitan76.net/', // OGP の絶対 URL（ビルド時は SITE_URL が優先）
  lang: 'ja_jp', // <html lang> と og:locale
};
