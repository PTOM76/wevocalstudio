# ファイル構成
どこに何があるか。下の一覧は `npm run map -- --write` で各ファイルの 1 行目の説明から作る（手で直さない）。

関連: [アーキテクチャ](ARCHITECTURE.md) / [コーディング規約](CODING.md)

## ファイルの一覧
<!-- map:start -->
```
src/
  App.tsx  画面の組み立て。上のバー、時間軸、選んだ波形ブロックの欄、ステータスバー、ダイアログ
  appConfig.ts  アプリの定義（名前、URL、保存のキー）を画面から使う形にする
  appInfo.ts  アプリの定義。vite.config.ts からも読み込むので、ほかのファイルを import しない（画面からは appConfig.ts の app を使う）
  autosave.ts  作業の自動保存と復元（IndexedDB）。元の音は書き換えないので 1 回だけ書き、トラックと波形ブロックは変わるたびに書く
  BlockDialog.tsx  波形ブロックのプロパティ（REAPER のアイテムのプロパティ）。位置、長さ、音量、ピッチ、処理方式、フェードを数値で指定する
  blockDrag.ts  波形ブロックのドラッグ（移動、端で長さを変える、角でフェード）の計算。画面を知らない
  drawTimeline.ts  時間軸の描画（目盛り、トラックの区切り、波形ブロック、再生位置）
  engine.ts  再生と書き出し。波形ブロックごとに元の音（ピッチを変えたものはキャッシュ）から Web Audio のノードを組む（再生は AudioContext、書き出しは OfflineAudioContext）
  ExportDialog.tsx  書き出しのダイアログ（形式、WAV のサンプル形式、ビットレート）。全トラックをマスターまで混ぜて書き出す
  grid.ts  時間軸の線（拍と小節、または時間）と、スナップの寄せ先。画面を知らない
  i18n.ts  多言語化（訳文は lang/ の JSON）
  keymap.ts  キーの割り当ての表。操作の名前 → キー。キーを変えるときはここだけ直す（あとで設定から変えられるようにする）
  main.tsx  起動。設定を読み、言語、テーマ、画面の大きさを PevenProvider に渡す
  overlap.ts  重なった波形ブロックの段の割り当て（REAPER と同じく、重なっている所だけトラックの高さを段に分ける）。画面を知らない
  project.ts  プロジェクトの形（元の音声、トラック、波形ブロック）。音声は書き換えず、波形ブロックの値から再生と書き出しのたびに作る
  projectFile.ts  プロジェクトファイル（.wvstudio）の読み書き。先頭に JSON（トラック、波形ブロック、元の音の形）、そのあとに元の音の PCM を並べる
  settings.ts  アプリの設定（localStorage に保存する）
  SettingsDialog.tsx  設定画面（外枠は PevenMUI の SettingsDialog）
  Timeline.tsx  時間軸。左にトラックの欄、右に波形ブロックを並べた canvas。波形ブロックはドラッグで動かし（ほかのトラックへも移せる）、端で長さ、上の角でフェードを変える
  TrackHeader.tsx  トラックとマスタートラックの左の欄（名前、ミュート、ソロ、音量、パン）。名前はダブルクリックで変える
  Transport.tsx  再生のボタン一式（REAPER のトランスポート。先頭へ、停止、再生、一時停止、リピート、末尾へ）と時間の表示。見た目は WeVocalSynth のツールバーと同じ
  useActions.ts  操作の表（キーとメニューから行うもの）と、メニューバーの並び
  useProject.ts  プロジェクトの状態と操作（読み込み、マスター、トラック、波形ブロックの変更）と、元に戻す、やり直す

src/dsp/
  pitch.ts  波形ブロックのピッチと速度を音に反映する。元の音全体を変えて作り、キャッシュする（再生のたびには計算しない）
  worker.ts  wasm のピッチ変更を画面のスレッドの外で行う Worker

dsp/src/
  lib.rs  WeVocal Studio の wasm。wevocal-lib のピッチ変更（WeVocalSynth と同じ処理方式）を、Worker から呼べる C ABI で公開するだけ。
```
<!-- map:end -->
