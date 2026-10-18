# 開発環境構築
手元で動かすまでの手順と、よく利用するコマンド。

関連: [アーキテクチャ](ARCHITECTURE.md)、[コーディング規約](CODING.md)

## 必要なもの

| 項目 | バージョン | 要るとき |
| --- | --- | --- |
| Node.js | 22 | 常に |
| Rust（rustup） | 安定版 | DSP（`dsp/`）を変えるときだけ |
| wasm32 ターゲット | — | 同上。`rustup target add wasm32-unknown-unknown` で入れる |

`src/dsp/wevocal_dsp.wasm` をリポジトリに含めているので、画面だけを触るなら Rust は要らない。

## 手順

```bash
npm install
npm run dev        # 開発サーバー。表示された URL をブラウザで開く
```

DSP を触るときは、先に Rust の準備をする。

```bash
rustup target add wasm32-unknown-unknown   # 初回だけ
npm run build:wasm                         # dsp/ をビルドして src/dsp/wevocal_dsp.wasm を作り直す
```

`dsp/.cargo/config.toml` で wasm の SIMD（simd128）を有効にしている。`build:wasm` を通さずに `cargo build` した場合も同じ設定が使われる。

## よく使うコマンド

```bash
npm run dev          # 開発サーバー
npm run build        # 型チェックと本番ビルド（dist/）
npm run lint         # oxlint
npm run test:dsp     # DSP のテスト（Rust）
npm run build:wasm   # DSP を変えたあと
npm run preview      # ビルド結果の確認
```

PWA（Service Worker）は開発サーバー（`npm run dev`）では動かない。オフライン動作・新しい版の通知・設定の「今すぐ確認」「オフライン用キャッシュを削除」は、`npm run build` のあと `npm run preview` で確かめる。

画面の重さを調べるときは Ctrl+Shift+D（または「設定」→「開発者向け」）でデバッグ表示を有効にする。FPS・一番重かったフレーム・長いタスク・部品の描画回数・音声データの内訳・DSP の処理時間が見られる。部品の描画回数を数えたいときは、その部品の先頭で `countRender('名前')` を呼ぶ。

3分の音声での処理時間は、`dsp/` で `cargo test --release -- --ignored --nocapture` を実行すると測れる。

### タスクランナー (任意)

よく使うコマンドは `todofile.json5` にまとめてあり、[Todofile](https://github.com/Pitan76/Todofile) があれば短く呼べる。無くても上のコマンドを直接打てば同じ。

```bash
composer global require pitan76/todofile   # 入れる (初回だけ)

todo setup      # 初回のセットアップ一式 (npm install と wasm32 ターゲットの追加)
todo check      # コミット前の確認をまとめて (lint、DSP のテスト、ビルド。書き換えはしない)
todo wasm       # DSP を変えたあと
todo bench      # 3分の音声での処理時間
```

ほかのタスクは `todofile.json5` を参照。

## デプロイ
main に push すると GitHub Actions（`.github/workflows/deploy.yml`）がビルドし、GitHub Pages に公開する。

- wasm はコミット済みのものを使う（CI では Rust をビルドしない）。DSP を変えたら `npm run build:wasm` の結果もコミットする
- 公開先がリポジトリ名のサブパスになるため、`BASE_PATH` でベースパスを渡している（`vite.config.ts`）

## うまく動かないとき

| 症状 | 原因と対処 |
| --- | --- |
| `npm run build:wasm` で `can't find crate for core` | wasm32 ターゲットが入っていない。`rustup target add wasm32-unknown-unknown` |
| DSP を直したのに動きが変わらない | `src/dsp/wevocal_dsp.wasm` が古いまま。`npm run build:wasm` を実行し、ブラウザを再読み込みする |
| `npm install` が終わらない、途中で止まる | 大きなパッケージの展開に時間がかかっている。`node_modules` を使っているエディタや別の npm を止めてからやり直す（`@mui/icons-material` はこれが原因で使うのをやめた） |
| 起動時に前の作業が自動的に表示される | 自動保存からの復元。「ファイル」→「設定…」で自動保存を OFF にすると、保存済みのデータも削除される |
