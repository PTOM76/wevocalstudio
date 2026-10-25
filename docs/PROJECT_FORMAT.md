# プロジェクトファイル（.wvst）の形式
WeVocal Studio の作業（元の音、トラック、波形ブロック、MIDI ブロック、テンポ、マーカー）を保存するファイルの形式。読み書きは [src/projectFile.ts](../src/projectFile.ts)（`writeProject` / `readProject`）、型は [src/project.ts](../src/project.ts)。

関連: [アーキテクチャ](ARCHITECTURE.md) / [機能の仕組み](INTERNALS.md)

元に戻す履歴は保存しない。元の音は書き換えないので、波形ブロックで加工した音は保存せず、開いたあとに波形ブロックの値から作り直す（[アーキテクチャ](ARCHITECTURE.md)の「原音から作る」）。

拡張子を短くする前の `.wvstudio` も、中身は同じなのでそのまま開ける。WeVocalSynth のプロジェクト（.wvsp）も開けるが、形式は別（WeVocalSynth の docs/PROJECT_FORMAT.md）。

## 全体の並び
圧縮しない。数値はすべてリトルエンディアン。

| 位置 | 大きさ | 内容 |
| --- | --- | --- |
| 0 | 4 バイト | 印 `WVST`（ASCII） |
| 4 | 4 バイト | ヘッダ JSON の長さ（バイト、u32） |
| 8 | ヘッダの長さ | ヘッダ JSON（UTF-8） |
| 8 + ヘッダの長さ | 0〜3 バイト | 詰め物。PCM を 4 バイト境界から始める（`Float32Array` で直接読めるように） |
| その後 | 残り | 元の音の PCM |

## ヘッダ JSON

| キー | 型 | 内容 |
| --- | --- | --- |
| `version` | 数値 | 形式の版（今は 2） |
| `sources` | 配列 | 元の音の形（下の表）。PCM はこの順で並ぶ |
| `tempo` | オブジェクト（省略可） | `{ bpm, beatsPerBar, beatOffset }`。1拍目の位置は秒。無ければ既定値 |
| `markers` | 配列（省略可） | `{ id, time, name, tempo? }`。位置は秒。`tempo` は `{ bpm, beatsPerBar }` で、そのマーカーの位置からのテンポ（WeVocalSynth と同じ形） |
| `master` | オブジェクト | マスタートラック（音量 dB、パン、ミュート、FX の列など） |
| `tracks` | 配列 | トラック（下の表） |
| `blocks` | 配列 | 波形ブロック（下の表） |
| `midi` | 配列（省略可） | MIDI ブロック（下の表）。無ければ書かない |
| `end` | 数値（省略可） | 曲の終わり（秒）。無ければ最後のブロックの終わりと FX の余韻から決める |

`sources` の各要素:

| キー | 内容 |
| --- | --- |
| `id` | 波形ブロックが指す名前 |
| `name` | ファイル名など |
| `sampleRate` | サンプルレート |
| `channels` | チャンネル数 |
| `frames` | 1 チャンネルのサンプル数 |

`tracks` の主な項目（すべては `Track` の型を参照）:

| キー | 内容 |
| --- | --- |
| `id`、`name` | 見分けと名前 |
| `volume`、`pan`、`mute`、`solo`、`invert` | 音量（dB）、パン（-1〜1）、ミュート、ソロ、位相の反転 |
| `parent` | 親のトラック（サブトラック）。子は親のすぐ後ろに並ぶ |
| `fx`、`sends`、`instrument` | FX の列、センド、音源（MIDI ブロックを鳴らすプラグイン。`plugin`、つまみの値の `values`、サンプラーの音色の `sample`、サンプラーのフォルマント保持の処理方式の `algorithm`） |
| `frozen` | フリーズ。書き出した音（`sources` の id）と、その頭の位置（秒） |

`blocks`（波形ブロック）の主な項目:

| キー | 内容 |
| --- | --- |
| `id`、`track`、`source` | 見分け、置いているトラック、元の音 |
| `start`、`length`、`offset` | 時間軸での位置と長さ（秒）、元の音の中での開始位置（秒） |
| `rate`、`pitch`、`formant`、`algorithm`、`preserveFormant` | 速度、ピッチ（半音）、フォルマントのずらし量、処理方式、フォルマントを保持するか |
| `gain`、`fadeIn`、`fadeOut`、`mute` | 音量（dB）、フェード（秒）、ミュート |
| `curve`、`envelope`、`pitchEnvelope` | ピッチカーブ（元の音の時刻 `from` 秒から 10ms ごとの半音）、音量とピッチのエンベロープ |

`midi`（MIDI ブロック）の主な項目: `id`、`track`、`start`、`length`、`mute`、`unit`（`'beat'`）、`notes`（`{ id, t, dur, pitch, vel, mute? }`。時間は拍）、`curves`（CC とピッチベンド）、`loop`（ループの長さ。拍）。

## 元の音の PCM
`sources` の順に、各チャンネルの 32bit float（`frames` 個）を、チャンネル 0、1、… と並べる。元の音を劣化させないため、圧縮しない。

## 古いファイルの読み替え
足した項目が古いファイルに無くても開けるように、読み込み時に既定値で埋める（`fillTrack`、`fillBlock`、`fillMidi`）。形を変えたら `VERSION` を上げ、古い版の読み替えを足す（[アーキテクチャ](ARCHITECTURE.md)の「保存したデータは壊さない」）。

| 古い形 | 読み替え |
| --- | --- |
| トラックの `eq`（グラフィック EQ） | FX の列の先頭に移す。保存はしない |
| `unit` の無い MIDI ブロック | 音符の時間が秒なので拍に直す。`id` の無い音符に `id` を付ける |
