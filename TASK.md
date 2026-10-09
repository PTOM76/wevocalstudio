# TASK

## MVP（済み、2026-10-09。docs/VERSION.md）

## Synth と Analyzer にそろえる（Synth の memo/studio.md の 7 章）
済み: フォルマント、マーカー、テンポの解析、ミニマップ、EQ、解析の欄（スペクトログラム、F0）、無音で区切る、位相の反転、操作履歴

- ピッチカーブ（ペンで描く、つかんで動かす。curve は wevocal-lib に済み。Studio の wasm に process_curve_planar を足す）
- 音量の曲線（波形ブロックのエンベロープ）
- テンポの途中の変化（Synth の tempoMap を wevocal-lib へ）
- ボーカル抽出、楽器ごとの分離（追加機能。Extractor）
- 歌詞の文字化と読み（追加機能。Analyzer の analyzer-lyrics、whisper）
- 音声の作成、MIDI に並べる、一音ずつ切り出す
- 動画の書き出し（追加機能。Converter）、選択範囲をフォルダーへ保存
- 複数のウィンドウ（windowSlot を PevenMUI へ）、スマホの画面（PevenMUI の MobileLayout）
- 試験的機能（和音の分離、五十音）

## そのあと
- エフェクトを足す（コンプレッサー、リバーブなど）、VST（ネイティブ版、Tauri）
