# WeVocal Studio
WeVocal Studio は、複数のトラックに波形ブロックを並べて編集する、ブラウザで動く音声編集 DAW である。音声は外部に送らない。現在は試験版（v0.0.2）。

## できること
| 分類 | 機能 |
| --- | --- |
| 配置 | 音声ファイルをトラックに波形ブロックとして並べる、移動、分割、削除 |
| 波形ブロック | 音量、ピッチ（WeVocalSynth と同じ処理方式）、フェード、ミュート |
| トラック | 音量、パン、ミュート、ソロ |
| 出力 | 再生、WAV で書き出す |

## 技術スタック
| 項目 | 内容 |
| --- | --- |
| 画面 | React + TypeScript + MUI（[PevenMUI](https://github.com/PTOM76/pevenmui)、Vite） |
| 音声 | Web Audio、Rust（WebAssembly）、[wevocal-lib](https://github.com/PTOM76/wevocal-lib) |

## セットアップ
```bash
npm install
npm run dev
```

`pevenmui/`、`wevocal-lib/`、`analyzer/` は submodule（`git submodule update --init`）。隣に WeVocalSynth（`../wevocalsynth`）があれば、その中のものを先に使う（両方を直しながら開発できるように）。submodule を Synth の中のコミットにそろえるには `todo update:modules`。

GitHub Pages へは、main に push すると GitHub Actions（`.github/workflows/deploy.yml`）が公開する。

## ドキュメント
- [アーキテクチャ](docs/ARCHITECTURE.md)
- [コーディング規約](docs/CODING.md)
- [バージョン履歴](docs/VERSION.md)

## License
MIT
