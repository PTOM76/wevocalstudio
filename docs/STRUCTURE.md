# ファイル構成
どこに何があるか。下の一覧は `npm run map -- --write` で各ファイルの 1 行目の説明から作る（手で直さない）。

関連: [アーキテクチャ](ARCHITECTURE.md) / [コーディング規約](CODING.md)

## ファイルの一覧
<!-- map:start -->
```
src/
  addons.ts  配信している追加機能の一覧と、このアプリでの呼び名（導入と読み込みの仕組みは PevenMUI。一覧は extractor の host.ts。WeVocalSynth と同じ）
  AnalysisPanel.tsx  解析の欄（WeVocalAnalyzer のスペクトログラムと F0）。選んだ波形ブロックの音を、時間軸とそろえて下に描く。ペンでピッチカーブを描く
  anticipate.ts  先に計算して鳴らす（Anticipative FX processing）。重いプラグインを持つトラックの音を、再生位置より先に別のスレッド（OfflineAudioContext の描画）で作っておき、
  App.tsx  画面の組み立て。上のバー、時間軸、選んだ波形ブロックの欄、ステータスバー、ダイアログ
  appConfig.ts  アプリの定義（名前、URL、保存のキー）を画面から使う形にする
  AppDialogs.tsx  アプリ全体のダイアログ（ショートカット、履歴、書き出し、設定、ライセンス、バージョン情報。WeVocalSynth の AppDialogs と同じ役目）
  AppDock.tsx  ドック（画面の下の欄に、ダイアログを置けるようにする PevenMUI の DockProvider）に、アプリの訳文を渡す
  AppHeader.tsx  上部のバー（WeVocalSynth の AppHeader と同じ）。PC は低いメニューバー、スマホは上部バー。右端に元に戻す、やり直し
  appInfo.ts  アプリの定義。vite.config.ts からも読み込むので、ほかのファイルを import しない（画面からは appConfig.ts の app を使う）
  autoLane.ts  時間軸に出すオートメーションのレーン（トラックとマスターに重ねて描く折れ線）。位置の計算、描画、点を押したかの判定。画面を知らない
  bake.ts  波形ブロックの確定（今の速度、ピッチ、音量、フェード、エンベロープを音にして、新しい元の音に置き換える）
  beats.ts  秒と拍（4 分音符 = 1）の変換。テンポの区間（マーカーで変わる）をたどる。MIDI ブロックの音符は拍で持ち、鳴らすときと描くときに秒へ直す。画面を知らない
  BlockDialog.tsx  波形ブロックのプロパティ。複数を選んでいれば一括で変える（触った欄だけを全部に掛ける）。元の音も選び直せる
  blockDrag.ts  波形ブロックのドラッグ（移動、端で長さを変える、角でフェード）の計算。画面を知らない
  BlockEditBar.tsx  画面の下に出す編集のボタンの列（PevenMUI の EditBar）。波形ブロックを選んでいれば波形ブロックの編集、範囲を選んでいれば範囲の編集
  drawTimeline.ts  時間軸の描画（目盛り、トラックの区切り、波形ブロック、再生位置）
  engine.ts  再生と書き出し。波形ブロックの音は、トラックごとのミキサー（AudioWorklet）が 128 サンプルずつ今かかっている所だけを読んで足す。
  envelopes.ts  エンベロープの種類（音量とピッチ）。点の読み書きと、波形ブロックの中の縦の位置と値の換算をまとめる（時間軸の編集と描画で共通）
  freeze.ts  トラックのフリーズ。トラックの波形ブロックの音（ピッチ、速度、音量、フェード、エンベロープ）を書き出して普通の音声として鳴らし、ピッチなどの処理を止める。
  fxCache.ts  先に作った FX の音（anticipate.ts のかたまり）を、再生をまたいで取っておく。同じトラックの同じ音、同じ位置なら描かずに使う（memo/fx-cache.md）
  glide.ts  選んだ波形ブロックの、前のピッチからなめらかにつなぐ（ポルタメント）。各波形ブロックの頭に、前の波形ブロックの終わりのピッチから自分のピッチへ戻るピッチのエンベロープを足す。画面を知らない
  GlideDialog.tsx  ピッチをつなぐ長さと、エンベロープの形状を選ぶダイアログ
  grid.ts  時間軸の線（拍と小節、または時間）と、スナップの寄せ先。画面を知らない
  history.ts  操作履歴の名前。変える前と後のプロジェクトを比べて、何をしたかを決める（呼び出す所ごとに名前を渡さずに済むように）
  i18n.ts  多言語化（訳文は lang/ の JSON）
  InstrumentDialog.tsx  トラックの音源（MIDI ブロックの音符を鳴らすプラグイン）の選択とつまみ。サンプラーは音色にする元の音（プロジェクトの元の音から）も選ぶ
  keymap.ts  キーの割り当て。既定の表（操作の名前 → キー）と、設定の「キーとマウス」で変えた分（PevenMUI の keymap と同じ形）
  LevelMeter.tsx  音量メーター（wevocal-lib の ThemedLevelMeter。WeVocalSynth と共通）
  main.tsx  起動。設定を読み、言語、テーマ、画面の大きさを PevenProvider に渡す
  MeterFader.tsx  音量のつまみとレベルメーターを一つにした部品と、パンの棒（wevocal-lib の MeterFader。WeVocalSynth と共通）
  MidiBlockDialog.tsx  MIDI ブロックのプロパティ（位置、長さ、ミュート）。音符はピアノロールで編集する
  midiBlocks.ts  MIDI ブロックの時間軸での描画と、押した所の判定（音符は小さな帯で見せる）。画面を知らない
  midiCurves.ts  MIDI ブロックのコントロール（CC とピッチベンドの曲線）の計算。点を直線でつなぐ。画面を知らない
  midiExport.ts  MIDI ファイルの書き出し。MIDI ブロックを、トラックごとの音符にして標準 MIDI ファイルにする。画面を知らない
  midiImport.ts  MIDI ファイルの読み込み。選んだトラック（チャンネルで分けることもできる）ごとに、新しいトラックと MIDI ブロックを作る（音源は標準のシンセ）。画面を知らない
  MidiImportDialog.tsx  MIDI ファイルの読み込みの選択（トラック、チャンネルで分けるか、テンポをどうするか、置く位置）
  optimize.ts  最適化して保存するためのプロジェクトの整理（波形ブロックの確定、使っていない元の音の部分を切る、使っていない元の音を消す）。元のプロジェクトは書き換えない
  OptimizeDialog.tsx  最適化して保存のダイアログ（何を確定し、何を捨てるかを選ぶ。実行は useProjectFile の saveOptimized）
  overlap.ts  重なった波形ブロックの段の割り当て（重なっている所だけトラックの高さを段に分ける）。画面を知らない
  overview.ts  ミニマップ用の、全トラックを重ねた小さな音（1 秒 1000 点の振幅）。元の音は書き換えず、波形ブロックの位置と音量から作る
  peaks.ts  波形の描画用のピーク（縮めた形）。元の音ごとに一度だけ、何段階かの細かさで最小と最大を作っておく（描くたびに元の音を読まないように）
  PianoRollDialog.tsx  ピアノロールのダイアログ（中身は pianoRoll/PianoRoll.tsx）。MIDI ブロックの音符を編集する
  pitchCurveTools.ts  ピッチの一括操作（wevocal-lib の計算。WeVocalSynth と同じ）を、波形ブロックのピッチカーブにする。元の F0 との差を半音で持つ（ペンと同じ形）
  PitchToolBar.tsx  解析の欄のピッチの道具（平らにする、音程にそろえる、ビブラート、MIDI の当てはめ）。計算とダイアログは wevocal-lib（WeVocalSynth と同じ）。結果は波形ブロックのピッチカーブにする
  project.ts  プロジェクトの形（元の音声、トラック、波形ブロック）。音声は書き換えず、波形ブロックの値から再生と書き出しのたびに作る
  projectFile.ts  プロジェクトファイル（.wvst）の読み書き。先頭に JSON（トラック、波形ブロック、元の音の形）、そのあとに元の音の PCM を並べる
  rangeEdit.ts  範囲選択（全トラックにかかる時間の範囲）への編集。範囲だけ残す、範囲を消して詰める、無音を挿入する（WeVocalSynth の編集メニューと同じ操作）
  sampler.ts  選んだ波形ブロックを MIDI の音符に並べる、一音ずつに分ける（どちらも波形ブロックを写して位置、ピッチ、長さを決める。音は処理しないので、あとから直せる）
  SendDialog.tsx  トラックのセンド（このトラックの音を、ほかのトラックの入口へ送る。フェーダーのあとの音を、送る量だけ。リバーブなどを共有するバスに使う）
  ShortcutsDialog.tsx  ショートカットの一覧のダイアログ（部品は PevenMUI の ShortcutsDialog。WeVocalSynth と同じ）
  StatusBar.tsx  PC の下のステータスバー（WeVocalSynth と同じ並び）。プロジェクト名、書き出しの形式、範囲選択、BPM、処理中のゲージ
  Timeline.tsx  時間軸。左にトラックの欄、右に波形ブロックを並べた canvas。波形ブロックはドラッグで動かし（ほかのトラックへも移せる）、端で長さ、上の角でフェードを変える
  Toolbar.tsx  メニューの下の小さなツールバー（WeVocalSynth と同じ形）。再生位置に追従するか、スナップ、拡大と縮小
  ToolDialog.tsx  プラグインの道具と解析（選んだ波形ブロックの音に対して実行する）。道具は加工した音を新しい元の音にして置き換え（確定と同じ。元に戻せる）、解析は結果の一覧を出す
  TrackHeader.tsx  トラックとマスタートラックの左の欄（名前、録音待機、ミュート、ソロ、音量、パン、位相の反転、EQ）。名前はダブルクリックで変える
  TrackPropertiesDialog.tsx  選択中のトラックの共通プロパティをまとめて編集する
  Transport.tsx  再生のボタン一式（先頭へ、停止、再生と一時停止、録音、リピート、末尾へ）、時間の表示、マスターのメーター、テンポとグリッド。部品は WeVocalSynth のツールバーと同じ
  useActions.ts  操作の表（キーとメニューから行うもの）と、メニューバーの並び
  useAddonFolder.tsx  追加機能の保存先のフォルダー（試験的）。許可の通知と、設定と自動保存した作業の写しは PevenMUI の useAddonFolderSync（WeVocalSynth と同じ）
  useAutosave.ts  起動時に前回の作業を戻し、変わったら少し待って書く（WeVocalSynth と同じ。書き込みは Worker）
  useDialogs.ts  ダイアログの開閉と、開くときに渡す値（PevenMUI の useDialogs。WeVocalSynth と同じ）
  useExtract.tsx  ボーカル抽出と楽器ごとの分離、和音の分離（手順は extractor の host.ts。WeVocalSynth と共通）。選んだ波形ブロックの音を分けて、新しいトラックに並べる
  useMidiInput.ts  MIDI 入力（キーボードなどの接続。ブラウザの Web MIDI。Chrome、Edge。Safari は非対応）。つないだ入力すべての、鳴らす、離すを onNote に渡す
  usePlayerSync.ts  再生中の同期。範囲や曲の終わりで止める、再生中に変えたものを音に反映する、ピッチを変えた音を用意してゲージを動かす
  useProject.ts  プロジェクトの状態と操作（読み込み、マスター、トラック、波形ブロックの変更）と、元に戻す、やり直す
  useProjectFile.ts  プロジェクトの開く、保存（上書きと名前を付けて）、書き出し、最近使用したファイル、OS から開く、閉じる前の確認（WeVocalSynth と同じ PevenMUI の fileAccess）
  useRecorder.ts  録音（再生位置から、ほかのトラックを鳴らしながら録り、録った音を波形ブロックとして置く。wevocal-lib の録音）
  useTempoDetect.ts  テンポの解析（選んだ波形ブロックから。WeVocalSynth と同じ解析）と、BPM、1 拍目の位置の設定
  wvspExport.ts  プロジェクトを WeVocalSynth のプロジェクト（.wvsp）にする。波形ブロックがあるトラックを 1 本ずつ描画して wvsp のトラックにする（memo/wvsp-export.md）

src/dsp/
  pitch.ts  wasm の処理の窓口。波形ブロックのピッチと速度を音に反映し（作ったものはキャッシュ）、テンポを解析する。
  samplerPitch.ts  サンプラーの「フォルマントを保持」。音符の高さごとに、元の音を波形ブロックと同じピッチ処理（フォルマントを保つ方式）で作るための、見えない波形ブロックを決める。画面を知らない
  worker.ts  wasm の処理（ピッチと速度の変更、テンポの解析、和音の分離）を画面のスレッドの外で行う Worker

src/mixer/
  mixer.ts  ミキサー（AudioWorklet）の読み込みと、トラックごとのミキサー、音のデータの送り先、波形ブロックから声を作る
  mixer.worklet.ts  波形ブロックの音を足すミキサー（AudioWorklet。音を出すスレッドで 128 サンプルずつ、今かかっている声だけを読んで足す）
  types.ts  ミキサー（AudioWorklet）とやり取りする形。時刻はすべて AudioContext の秒（currentTime と同じ時計）

src/pianoRoll/
  draw.ts  ピアノロールを描く（鍵盤、グリッド、音符、再生位置、強さの帯）。画面の部品は持たない
  edit.ts  ピアノロールの編集操作（移動、移調、長さ、クオンタイズ、コピーと貼り付け）。音符の並びを受けて、新しい並びを返す。画面を知らない
  hit.ts  ピアノロールで押した所の判定（音符、右端、強さの棒）。画面を知らない
  InfoLine.tsx  ピアノロールの情報行: 選んだ音符の値（複数のときは先頭の値）を数値で見て直す。入れた値は選んだ全部に反映する。右端には、下のレーンの選択
  laneEdit.ts  ピアノロールの下のレーン（強さ、ピッチベンド、CC）の曲線の編集。点の判定と、曲線の入れ替え。画面を知らない
  noteBus.ts  MIDI キーボードの弾いた音を、開いているピアノロールに渡す（ステップ入力で使う）。App が弾いた音を流し、ピアノロールが受ける
  PianoRoll.tsx  ピアノロールの本体（MIDI ブロックの音符を編集する）。ダイアログの枠は PianoRollDialog.tsx。
  ScreenKeyboard.tsx  画面の鍵盤（2 オクターブ。押している間鳴る。MIDI キーボードがない端末と、ステップ入力で使う）。左右のボタンで 1 オクターブずつずらす
  Toolbar.tsx  ピアノロールの上の部分（メニューバーとツールバー）。ダイアログと別のウィンドウに出したときに使う（PevenMUI の MenuBar を embedded で置く）。
  usePinch.ts  ピアノロールの 2 本指のつまみ（拡大と縮小、なぞって縦横にスクロール）。触れている指の位置を覚える
  useRollEdit.ts  ピアノロールの編集の操作（消す、コピーと貼り付け、複製、移調、クオンタイズ、接着など）と、そのキー操作
  useRollWheel.ts  ピアノロールのホイール: Ctrl で横の拡大（マウスの位置を動かさない）、Shift で横のスクロール、Alt で行の高さ、そのままで音の高さ。ページごと動かないよう passive にしない
  useStepInput.ts  ステップ入力: 鍵盤（MIDI キーボードか画面の鍵盤）を弾くたびに、入力位置に音符を置き、鍵盤を全部離したら入力位置を音符の長さだけ進める（和音は同時に押した分が同じ位置に入る）
  view.ts  ピアノロールの表示の位置と大きさ（拍と音の高さ、画面の座標の変換）。画面を知らない

src/settings/
  DataSection.tsx  設定の「データ」（使用量と、作業データ、キャッシュ、追加機能、設定の削除。部品と処理は PevenMUI。WeVocalSynth と同じ）
  PluginsSection.tsx  設定の「プラグイン」（導入と管理。部品は wevocal-lib の PluginManager。WeVocalSynth と共通）
  ProjectSection.tsx  プロジェクト設定の名前とテンポを編集する
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
  process.ts  「処理」（ピッチの処理方式）と時間軸の線の項目
  SettingRow.tsx  項目の定義から設定画面の 1 行を作る（部品は PevenMUI の SettingRow。WeVocalSynth と同じ）

src/storage/
  autosave.ts  作業の自動保存と復元（IndexedDB）。元の音は書き換えないので 1 回だけ書き、トラックと波形ブロックは変わるたびに書く。書き込みは Worker
  autosaveWorker.ts  自動保存の書き込みと読み出しをする Worker。数十〜百 MB の元の音の複製と保存を画面のスレッドから外す（WeVocalSynth と同じ）
  dataFolder.ts  設定と自動保存した作業を、指定したフォルダーにも写す（PWA を消しても戻せるように。処理は PevenMUI。WeVocalSynth と同じ）。画面と自動保存の Worker の両方から使う
  idb.ts  このアプリの IndexedDB（PevenMUI の createIdb。WeVocalSynth と同じ）。画面と自動保存の Worker の両方から使う

dsp/src/
  lib.rs  WeVocal Studio の wasm。wevocal-lib のピッチ変更とピッチカーブ（WeVocalSynth と同じ処理方式）とテンポの解析を、Worker から呼べる C ABI で公開するだけ。
```
<!-- map:end -->
