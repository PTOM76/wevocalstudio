# AGENTS.md

AI のエージェント向けの決まり。[docs/CODING.md](docs/CODING.md) の決まりも同じく守る。

- 表記は「WeVocal Studio」（WeVocal と Studio の間に半角スペース）。ほかの WeVocalSynth などは詰めたまま
- 仕組みは WeVocalSynth（`../wevocalsynth`）にそろえる。Synth と Analyzer にある機能は Studio にもそろえる
- どこに何があるかは `npm run map`。ファイルを足したら 1 行目に説明を書き、`npm run map -- --write`
- 訳文（`src/lang/`）は `npm run i18n`（使い方は Synth の AGENTS.md と同じ）。終わったら `fmt` と `check`。まとめた確認は `todo check`
- Synth から使う処理（ピッチの処理方式など）は、wevocal-lib に移してから使う。Studio に写さない
- 元の音は書き換えない。波形ブロックの値から再生と書き出しのたびに作る（docs/ARCHITECTURE.md）
- 画面の部品は自作しない。Synth に同じ役目の部品があれば PevenMUI（音声は wevocal-lib）に移し、Synth もそれを使う形にしてから使う。置き方（レイアウト）は Studio 独自でよい
- Synth の訳文を使うときは `node scripts/copy-i18n.mjs <key>...` で写す
- 設定は `src/settings/items/` の分類のファイルに 1 行で定義し、設定画面は `SettingsPages.tsx` に `S('名前')` を置く（Synth と同じ）
- ダイアログは `src/useDialogs.ts` の `DialogId` に名前を足し、描画は `src/AppDialogs.tsx` に置く。開くのは `dialogs.open('名前', 値)`
- submodule はコミットの前に自動で隣の Synth にそろう（`.githooks/`）。push は Synth の中の pevenmui、wevocal-lib などを先にする（push の前に確かめる）
