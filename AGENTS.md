# AGENTS.md

AI のエージェント向けの決まり。[docs/CODING.md](docs/CODING.md) の決まりも同じく守る。

- 表記は「WeVocal Studio」（WeVocal と Studio の間に半角スペース）。ほかの WeVocalSynth などは詰めたまま
- 仕組みは WeVocalSynth（`../wevocalsynth`）にそろえ、REAPER も参考にする。Synth と Analyzer にある機能は Studio にもそろえる
- どこに何があるかは `npm run map`。ファイルを足したら 1 行目に説明を書き、`npm run map -- --write`
- 訳文（`src/lang/`）は `npm run i18n`（使い方は Synth の AGENTS.md と同じ）。終わったら `fmt` と `check`。まとめた確認は `todo check`
- Synth から使う処理（ピッチの処理方式など）は、wevocal-lib に移してから使う。Studio に写さない
- 元の音は書き換えない。波形ブロックの値から再生と書き出しのたびに作る（docs/ARCHITECTURE.md）
