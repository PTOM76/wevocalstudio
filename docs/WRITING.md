# ドキュメントの書き方
`docs/` にドキュメントを足すときの決まり。WeVocalSynth の docs/WRITING.md と同じ決まりで、ここには Studio の場所と手順を書く。新しく書くときは [templates/](templates/) のひな形をコピーして始める。

## どこに書くか

| 記述内容 | 場所 |
| --- | --- |
| プロジェクトの概要、すぐ動かす手順 | ルートの `README.md`（大まかに。詳しいことは docs へリンクする） |
| 1つのテーマの詳しい説明 | `docs/<テーマ>.md` |
| 実装中に問題を踏んで決まったこと | [DECISIONS.md](DECISIONS.md) |
| 関数、型の細かい説明 | コードのコメント。docs には概要と場所だけ書く |
| 残作業と、利用者が確かめること（👤） | ルートの `TASK.md`。終わったものの記録は docs に移す |

1ファイル1テーマにする。既存のファイルに収まらないテーマなら新しく作る。読みたくない人の負担を減らすため、別の話題は別のファイルに分ける。

Synth と同じ仕組みのものは、Synth の docs を参照し、Studio で違うところだけを書く（同じ説明を 2 か所に書くと、片方だけが古くなる）。

## ファイル名
`docs/` 直下は英大文字にするのが好ましい（例: `ARCHITECTURE.md`、`SETUP.md`）。

## 読み手
リポジトリしか見られない、初めて WeVocal Studio に関わる開発者を想定する。
- 音声処理と DAW の用語（AudioWorklet、フリーズ、センドなど）は、初出で意味を書く

## 書き方（推奨）
- 3つ以上並ぶものや、項目ごとに説明が付くものは表にする
- 決まりごとには理由を書く。理由の無い決まりは守られないし、変えてよいかも判断できない
- 書き方の決まりは GOOD / BAD の例を並べる
- 関数名やファイルを挙げるときは、実在するものを使う。削除したら直す
- 表記は「WeVocal Studio」（半角スペースあり）。WeVocalSynth などほかのものは詰める

## リンク
- 相対パスで書く（`[決定事項](DECISIONS.md)`）
- 新しいファイルを作ったら、[docs/README.md](README.md) の目次と、ルートの README.md の「ドキュメント」の表に追加する

## 使い方（MANUAL.md）と wiki
- 使い方は [MANUAL.md](MANUAL.md) だけを書く。`docs/wiki/` のページ（`start.md` 以外）は `npm run docs:wiki`（`scripts/docs-to-dokuwiki.mjs`）が MANUAL.md と VERSION.md から作るので、手で書き換えない
- MANUAL.md の目次は見出しから作る。見出しを変えたら `node scripts/manual-toc.mjs --write`（`npm run docs:toc` は確かめるだけ）
- MANUAL.md に `##` の見出しを追加したら、`scripts/docs-to-dokuwiki.mjs` の `PAGES` にどのページに入れるかを追加する（追加しないとスクリプトが止まる）

## 画像
- 画面の画像（`docs/images/`）は `npm run docs:shots` で撮り直す（`scripts/screenshots/`）。開発サーバーを立て、ヘッドレスの Chrome でアプリを操作して撮る。一部だけなら `npm run docs:shots -- main toolbar` のように名前を並べる
- 追加機能の画面（解析の欄、動画の書き出し、ボーカル抽出）を撮るときは、先に `npm run build:addons:dev` を実行する
- 撮影用の音声は、スクリプトの中で作る（実在の曲を使わない。`app.mjs` の `dropMelody`）
- 番号付きの画像（`_with_note`）の番号は、ボタンなどの位置から計算して重ねる。MANUAL.md の表の番号と合わせる
- 新しい画像は `scripts/screenshots/` の desktop.mjs、dialogs.mjs、mobile.mjs に手順を追加する

| 名前 | 画像 | MANUAL の節 |
| --- | --- | --- |
| main | main.png、main_with_note.png | 画面 → パソコン |
| toolbar | toolbar_with_note.png | 画面 → ツールバー |
| mainLight | main-light.png | 画面 → パソコン |
| context | context.png | 右クリックのメニュー |
| range | range.png | 範囲の操作 |
| properties、fx | properties.png、fx.png | プロパティ、FX |
| export、video | export.png、video.png | 書き出し |
| extract、synth | extract.png、synth.png | ボーカル抽出、音声の作成 |
| settings | settings.png、addons.png | 設定 |
| mobile、mobileSelect、mobileLandscape | mobile.png、mobile-select.png、mobile-landscape.png | 画面 → スマホ |

`readme-pc.png` と `readme-mobile.png`（ルートの README.md）は手で撮ったもの。

## 更新
- コードを変えて内容が食い違ったら、同じ変更の中でドキュメントも直す
- 処理時間や「未確認のこと」のような時点で変わる情報には日付を付ける（例: `(2026-10-24 時点)`）
- バージョンを上げたら [VERSION.md](VERSION.md) に主な変更を書く
