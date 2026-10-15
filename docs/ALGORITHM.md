# アルゴリズム
WeVocal Studio の再生と書き出し（波形ブロックの音を混ぜる仕組み）が、どういう考え方で動いているかをまとめる。ピッチ変更などの音声処理は WeVocalSynth と同じ（WeVocalSynth の docs/ALGORITHM.md）。細かい値や実装の工夫は、各ファイルの先頭のコメントにある。(2026-10-15 時点)

関連: [アーキテクチャ](ARCHITECTURE.md)

## 用語

| 用語 | 意味 |
| --- | --- |
| AudioWorklet | 音を出すスレッドで動かせる処理。128 サンプル（48 kHz で約 2.7 ms）ごとに呼ばれる |
| ミキサー | トラックごとの AudioWorklet。そのトラックの波形ブロックの音を足して出す |
| 声 | 波形ブロックの片 1 つ（元の音そのままか、ピッチを変えたかたまり） |
| 片、かたまり | ピッチを変えた音は 4 秒ごとのかたまりで作る。波形ブロックの範囲にかかる部分が片 |

## 全体の流れ

1. 画面（メイン）でプロジェクトが変わると、波形ブロックをトラックごとの声の一覧にする（`src/mixer/mixer.ts` の `voicesOf`）
2. 声が使う音のデータを、まだ送っていなければミキサーに送る（AudioContext ごとに 1 回だけ）
3. 声の一覧をトラックのミキサーに送る
4. ミキサーは 128 サンプルごとに、今の時刻にかかっている声だけを読み、音量を掛けて足す（`src/mixer/mixer.worklet.ts`）
5. ミキサーの出力は、トラックの EQ、パン、メーター、マスター（Web Audio のノード）を通って出る

書き出しも OfflineAudioContext で同じミキサーを使う。再生と書き出しで同じ音になる。

## なぜミキサーにしたか

前は、波形ブロックの片ごとに AudioBufferSourceNode を作り、時刻を指定して予約していた。

- 予約したノードはブラウザの中で生き続け、数が多いほど重くなる
- 再生位置を変えるたびに、予約を全部捨てて作り直す
- 波形ブロックが 907 個の曲で再生位置を何度も変えると、数秒鳴らなくなった

DAW の一般的な作りは、音を出すスレッドが短い長さずつ次の音を求め、エンジンはそのたびに今かかっているものだけを計算して返す、というもの。ブラウザで音を出すスレッドに入れるのは AudioWorklet だけなので、そこにミキサーを置いた。再生位置を変えても読む位置が変わるだけで、ノードは作らない。

ブラウザの DAW の比較（[参考にした資料](#参考にした資料)の Knapp）でも、AudioBufferSourceNode で予約する方式はメモリが増え続けて画面が重くなり、AudioWorklet で流す方式はメモリが安定していた。

## 声

声は時刻をすべて AudioContext の秒（`currentTime` と同じ時計）で持つ（`src/mixer/types.ts`）。

| 値 | 意味 |
| --- | --- |
| t0、t1 | 鳴らす範囲 |
| clip、f0 | 音のデータの番号と、t0 に読む位置（サンプル） |
| bt0、bt1、fadeIn、fadeOut | 波形ブロックの範囲とフェード |
| joinIn、joinOut | 隣の片とのつなぎ目のクロスフェード |
| level、env | 音量と、音量のエンベロープ（時刻と音量を交互に並べたもの） |
| key、sig | 見分けと、値を比べる文字 |

- 片のつなぎ目は、前後に 5 ms ずつ伸ばして重ねる（かたまりには前後 0.5 秒の余白があるので、伸ばした所にも音がある）
- 元の音と出力のサンプルレートが違うときは、その比で読む位置を進め、隣のサンプルとの直線で求める

## ミキサーの処理

- 音量は 128 サンプルの頭と終わりで求め、その間は直線で結ぶ（フェードやつなぎ目は 5 ms 以上なので、これで十分なめらか）
- 声の一覧が届いたら key で前の声と比べる。sig が同じならそのまま鳴らし続け、変わった声は 20 ms でフェードアウトし、新しい声は（途中から始まるなら）20 ms でフェードインする。再生中に波形ブロックを動かしても途切れない
- 止めるときは 20 ms でフェードアウトし、終わったら処理をやめる（`process` が false を返す）
- 音のデータの置き場はミキサーのモジュールの変数で、同じ AudioContext のミキサーで共通（AudioWorklet はすべて同じスレッドで動くため）。元の音はプロジェクトにある間は消さず、ピッチを変えたかたまりは使わなくなったら消す。cross-origin isolation のときは、音のデータを SharedArrayBuffer に 1 回だけ置いてミキサーと共有する（写さない。再生を始めるたびに送り直さない）。isolation にならないとき（Safari、初めて開いた回）は postMessage で写して送る
- 書き出しでは、送ったものをミキサーが受け取ったのを確かめてから（ping と pong）計算を始める

ピッチを変えたかたまりは Worker で先に作ってキャッシュする（リアルタイムのピッチ変更は遅れがあり、長さが正確でないため）。ミキサーはできたものを読むだけ。

間に合わない所を無音にしないよう、再生位置（止まっていれば編集カーソル）から 15 秒先までの鳴る波形ブロックは、先に下見の音を作って鳴らす（`src/dsp/pitch.ts`）。下見は SOLA でフォルマントを変えずに作るので、高品質の方式（Phase Vocoder とフォルマント補正など）の数倍速い。高品質のかたまりができたら 20 ms のクロスフェードで差し替え、下見は捨てる。作る順番は、下見（近い順）→ 鳴る所の高品質（近い順。過ぎた所は後に回す）→ 鳴らない波形ブロック。一般的な DAW の「再生中は軽い方式で鳴らし、手が空いている間に裏で高品質に作る」と同じ考え方

## まだしていないこと

| 内容 | 理由、考え |
| --- | --- |
| EQ、パン、メーターもミキサーの中で計算する | トラックが多いときにノードを減らせる |
| WebAssembly にする | 128 サンプルごとに 1 回だけ呼んでまとめて計算するなら速い（細かく何度も呼ぶと逆に遅い） |
| 声の差分だけ送る | 今は声が変わったトラックの一覧を全部送る（変わっていないトラックには送らない。ドラッグ中は 50ms に 1 回まで） |

## 参考にした資料

| 資料 | 参考にしたところ |
| --- | --- |
| S. Knapp, [Browser-based Engine Prototype for a Digital Audio Workstation](https://reposit.haw-hamburg.de/bitstream/20.500.12738/16337/1/BA_Browser-based%20Engine%20Prototype%20for%20a%20Digital%20Audio%20Workstation.pdf)（HAW Hamburg 卒業論文） | AudioBufferSourceNode で予約する方式と AudioWorklet で流す方式を 96 トラックで比べた結果。前者は画面のフレームレートが落ち、メモリが約 2.5 GB まで増えて戻らなかった。後者はメモリが安定していた。WebAssembly はまとめて呼ぶと速く、細かく呼ぶと遅いこと |
| R. Bencina, [Real-time audio programming 101: time waits for nothing](http://www.rossbencina.com/code/real-time-audio-programming-101-time-waits-for-nothing) | 音を出すスレッドで待たない（ロック、メモリの確保、ファイルの読み込みをしない）。重い処理は別のスレッドで先に作って渡す |
| [Audio Worklet Design Pattern](https://developer.chrome.com/blog/audio-worklet-design-pattern)（Chrome） | 重い処理は Worker で行い、AudioWorklet には SharedArrayBuffer で渡す組み立て。AudioWorklet は Worker を待たないこと |
| [High Performance Web Audio with AudioWorklet in Firefox](https://hacks.mozilla.org/2020/05/high-performance-web-audio-with-audioworklet-in-firefox/)（Mozilla） | 同じ AudioContext の AudioWorklet は同じスレッドで動くこと。`process` の中で確保とガーベジを避けること |
| [A tale of two clocks](https://web.dev/articles/audio-scheduling)（web.dev） | 前の方式（先読みして時刻を指定して予約する）の考え方 |
| [Web Audio の mailing list](https://lists.w3.org/Archives/Public/public-audio/2016AprJun/0051.html) | 止めたあとのノードが CPU を使い続けることがあるという報告 |
| M. Buffa ほか, [WAM-Studio, a Digital Audio Workstation (DAW) for the Web](https://dl.acm.org/doi/fullHtml/10.1145/3543873.3587987) (2023) | ブラウザの DAW の組み立て |
| [Rubber Band Library](https://breakfastquay.com/rubberband/code-doc/) | リアルタイムのピッチ変更には遅れがあり補正が要ること（かたまりを先に作る今の方式を続ける理由） |
