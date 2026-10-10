# ファイル構成
どこに何があるか。下の一覧は `npm run map -- --write` で各ファイルの 1 行目の説明から作る（手で直さない）。

関連: [アーキテクチャ](ARCHITECTURE.md) / [コーディング規約](CODING.md)

## ファイルの一覧
<!-- map:start -->
```
src/
  AnalysisPanel.tsx  解析の欄（WeVocalAnalyzer のスペクトログラムと F0）。選んだ波形ブロックの音を、時間軸とそろえて下に描く。ペンでピッチカーブを描く
  App.tsx  画面の組み立て。上のバー、時間軸、選んだ波形ブロックの欄、ステータスバー、ダイアログ
  appConfig.ts  アプリの定義（名前、URL、保存のキー）を画面から使う形にする
  AppHeader.tsx  上部のバー（WeVocalSynth の AppHeader と同じ）。PC は低いメニューバー、スマホは上部バー。右端に元に戻す、やり直し
  appInfo.ts  アプリの定義。vite.config.ts からも読み込むので、ほかのファイルを import しない（画面からは appConfig.ts の app を使う）
  BlockDialog.tsx  波形ブロックのプロパティ。複数を選んでいれば一括で変える（触った欄だけを全部に掛ける）。元の音も選び直せる
  blockDrag.ts  波形ブロックのドラッグ（移動、端で長さを変える、角でフェード）の計算。画面を知らない
  drawTimeline.ts  時間軸の描画（目盛り、トラックの区切り、波形ブロック、再生位置）
  engine.ts  再生と書き出し。波形ブロックごとに元の音（ピッチを変えたものはキャッシュ）から Web Audio のノードを組む（再生は AudioContext、書き出しは OfflineAudioContext）。
  EqDialog.tsx  トラックのグラフィック EQ のダイアログ（WeVocalSynth と同じ EQ。グラフは wevocal-lib/react）
  grid.ts  時間軸の線（拍と小節、または時間）と、スナップの寄せ先。画面を知らない
  history.ts  操作履歴の名前。変える前と後のプロジェクトを比べて、何をしたかを決める（呼び出す所ごとに名前を渡さずに済むように）
  HistoryDialog.tsx  操作履歴の一覧（WeVocalSynth と同じ）。押した所まで戻る、または進む
  i18n.ts  多言語化（訳文は lang/ の JSON）
  keymap.ts  キーの割り当て。既定の表（操作の名前 → キー）と、設定の「キーとマウス」で変えた分（PevenMUI の keymap と同じ形）
  LevelMeter.tsx  音量メーター（wevocal-lib の部品にテーマの色を渡す。WeVocalSynth と同じ）
  main.tsx  起動。設定を読み、言語、テーマ、画面の大きさを PevenProvider に渡す
  MarkerDialog.tsx  マーカーの名前の変更と削除、ここからテンポを変える（目盛りの上のマーカーをダブルクリック。テンポは WeVocalSynth と同じ）
  MeterFader.tsx  音量のつまみとレベルメーターを一つにした部品と、パンの棒（トラックとマスターの欄。DAW によくある形）
  overlap.ts  重なった波形ブロックの段の割り当て（重なっている所だけトラックの高さを段に分ける）。画面を知らない
  overview.ts  ミニマップ用の、全トラックを重ねた小さな音（1 秒 1000 点の振幅）。元の音は書き換えず、波形ブロックの位置と音量から作る
  peaks.ts  波形の描画用のピーク（縮めた形）。元の音ごとに一度だけ、何段階かの細かさで最小と最大を作っておく（描くたびに元の音を読まないように）
  project.ts  プロジェクトの形（元の音声、トラック、波形ブロック）。音声は書き換えず、波形ブロックの値から再生と書き出しのたびに作る
  projectFile.ts  プロジェクトファイル（.wvstudio）の読み書き。先頭に JSON（トラック、波形ブロック、元の音の形）、そのあとに元の音の PCM を並べる
  rangeEdit.ts  範囲選択（全トラックにかかる時間の範囲）への編集。範囲だけ残す、範囲を消して詰める、無音を挿入する（WeVocalSynth の編集メニューと同じ操作）
  ShortcutsDialog.tsx  ショートカットの一覧のダイアログ（部品は PevenMUI の ShortcutsDialog。WeVocalSynth と同じ）
  StatusBar.tsx  PC の下のステータスバー（WeVocalSynth と同じ並び）。プロジェクト名、書き出しの形式、範囲選択、BPM、処理中のゲージ
  Timeline.tsx  時間軸。左にトラックの欄、右に波形ブロックを並べた canvas。波形ブロックはドラッグで動かし（ほかのトラックへも移せる）、端で長さ、上の角でフェードを変える
  Toolbar.tsx  メニューの下の小さなツールバー（WeVocalSynth と同じ形）。再生位置に追従するか、スナップ、拡大と縮小
  TrackHeader.tsx  トラックとマスタートラックの左の欄（名前、録音待機、ミュート、ソロ、音量、パン、位相の反転、EQ）。名前はダブルクリックで変える
  Transport.tsx  再生のボタン一式（先頭へ、停止、再生と一時停止、録音、リピート、末尾へ）、時間の表示、マスターのメーター、テンポとグリッド。部品は WeVocalSynth のツールバーと同じ
  useActions.ts  操作の表（キーとメニューから行うもの）と、メニューバーの並び
  useProject.ts  プロジェクトの状態と操作（読み込み、マスター、トラック、波形ブロックの変更）と、元に戻す、やり直す
  useProjectFile.ts  プロジェクトの開く、保存（上書きと名前を付けて）、書き出し、最近使用したファイル、OS から開く、閉じる前の確認（WeVocalSynth と同じ PevenMUI の fileAccess）

src/dsp/
  pitch.ts  wasm の処理の窓口。波形ブロックのピッチと速度を音に反映し（作ったものはキャッシュ）、テンポを解析する。
  worker.ts  wasm の処理（ピッチと速度の変更、テンポの解析）を画面のスレッドの外で行う Worker

src/settings/
  settings.ts  設定の保存と読み込み、Context（PevenMUI の createSettingsStore。WeVocalSynth と同じ）。項目の定義は items/ にある
  SettingsDialog.tsx  設定のダイアログ（PevenMUI の設定画面に、分類と中身を渡す。WeVocalSynth と同じ）
  SettingsPages.tsx  設定画面の分類ごとの中身（定義のある項目は S(名前) の 1 行。WeVocalSynth と同じ形）
  settingsSearch.ts  設定画面の分類の並びと、検索の対象（WeVocalSynth と同じ形）

src/settings/items/
  debug.ts  「開発者向け」の項目（名前と既定値は WeVocalSynth と同じ。devUpdates だけ開発中なので既定でオン）
  define.ts  設定の項目を定義する関数（check、choice、number、value）。仕組みは PevenMUI の settingItems（WeVocalSynth と共通）。ここは訳文のキーと分類の型を決めるだけ
  display.ts  「表示」の項目と、表示メニューとツールバーで切り替えるもの（名前と既定値は WeVocalSynth と同じ）
  general.ts  「全般」「編集」「キーとマウス」「ファイル」の項目（名前と既定値は WeVocalSynth と同じ）
  index.ts  設定の項目をまとめ、型と既定値を作る（PevenMUI の collectItems。WeVocalSynth と同じ形）
  process.ts  「ピッチ」と時間軸の線の項目
  SettingRow.tsx  項目の定義から設定画面の 1 行を作る（部品は PevenMUI の SettingRow。WeVocalSynth と同じ）

src/storage/
  autosave.ts  作業の自動保存と復元（IndexedDB）。元の音は書き換えないので 1 回だけ書き、トラックと波形ブロックは変わるたびに書く。書き込みは Worker
  autosaveWorker.ts  自動保存の書き込みと読み出しをする Worker。数十〜百 MB の元の音の複製と保存を画面のスレッドから外す（WeVocalSynth と同じ）
  idb.ts  IndexedDB の小さな読み書き（キーと値だけ）。画面と Worker の両方から使う

dsp/src/
  lib.rs  WeVocal Studio の wasm。wevocal-lib のピッチ変更とピッチカーブ（WeVocalSynth と同じ処理方式）とテンポの解析を、Worker から呼べる C ABI で公開するだけ。
```
<!-- map:end -->
