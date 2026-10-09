# AGENTS.md

AI のエージェント向けの決まり。[docs/CODING.md](docs/CODING.md) の決まりも同じく守る。

- 表記は「WeVocal Studio」（WeVocal と Studio の間に半角スペース）。ほかの WeVocalSynth などは詰めたまま
- 作り方は WeVocalSynth（`../wevocalsynth`）の docs と AGENTS.md を参考にする
- Synth から使う処理（ピッチの処理方式など）は、wevocal-lib に移してから使う。Studio に写さない
- 元の音は書き換えない。波形ブロックの値から再生と書き出しのたびに作る（docs/ARCHITECTURE.md）
