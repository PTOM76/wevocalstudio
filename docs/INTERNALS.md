# 機能の仕組み
読み込みから書き出しまでのデータの流れと、編集、再生、保存がどう動いているかをまとめる。方針と理由は [アーキテクチャ](ARCHITECTURE.md)、ミキサーの中身は [アルゴリズム](ALGORITHM.md) にある。(2026-10-24 時点)

関連: [アーキテクチャ](ARCHITECTURE.md) / [ファイル構成](STRUCTURE.md) / [アルゴリズム](ALGORITHM.md) / [決定事項](DECISIONS.md)

## データの流れ

### 読み込みから出力まで

| 段階 | 処理 |
| --- | --- |
| 読み込み | 音声ファイルは wevocal-lib の `decodeFile` で `Clip`（サンプルレートとチャンネルごとの `Float32Array`）にし、元の音（`Source`）としてプロジェクトに足す（`useProject.ts`）。同時に、空いているトラックか新しいトラックに波形ブロックを置く |
| 編集 | 画面の操作は `document/edits/` の純粋な関数を文書（`ProjectDocument`）の `change` に渡す。新しいプロジェクトが履歴の 1 段になる。元の音は変えない |
| 音を作る | ピッチ、速度、フォルマントを変えた波形ブロックは、元の音を 4 秒ごとのかたまりに分けて Worker の wasm で作り、キャッシュする（`src/dsp/pitch.ts` の `preparePitch`） |
| 再生 | 波形ブロックをトラックごとの声の一覧にし、トラックのミキサー（AudioWorklet）が今かかっている所だけを読んで足す（`engine.ts`、`src/mixer/`） |
| 書き出し | 同じミキサーを OfflineAudioContext で動かして全トラックを混ぜ（`src/engine/render.ts` の `renderMix`）、wevocal-lib の `exportAudio` で WAV / FLAC / MP3 / Opus / AAC にする（`useProjectFile.ts`） |

### 編集と履歴
- 文書は、プロジェクトと選択（波形ブロック、トラック、範囲）を wevocal-lib の `createHistoryStore` に持つ。選択も元に戻せる
- 続けての変更（ドラッグ、スライダー）は `merge` の名前が同じなら 1 段にまとめる。ドラッグ中の Esc は `cancelMerge` でその分を取り消す
- 操作履歴の名前は、呼び出す所で渡さず、変える前と後のプロジェクトを比べて決める（`src/history.ts` の `describeChange`）
- フリーズ中のトラックの波形ブロックへの変更は、`guard` でまとめて前の状態に戻す（`src/freeze.ts`）

### ピッチと速度
1. プロジェクトが変わると、`preparePitch` が鳴らす波形ブロックの「かたまり」の一覧を作る。区切りは元の音の時刻なので、範囲の違う波形ブロックでも同じかたまりを使い回す
2. 再生位置（止まっていれば編集カーソル）に近い順に、まず SOLA の下見を作り、次に設定の処理方式で高品質のものを作る。鳴らない波形ブロックは最後
3. できたかたまりはミキサーに送り、下見から 20ms のクロスフェードで差し替える。できていない所は鳴らさない
4. 使わなくなったかたまりも 300MB までは残す（戻したときに作り直さない）

処理方式そのもの（Vesola、Solis、Phasera など）は WeVocalSynth と同じ wevocal-lib の Rust（`dsp/` は wasm で公開するだけ）。

### 確定と最適化
- 確定（`src/bake.ts`）: 波形ブロックの今の音（速度、ピッチ、音量、フェード、エンベロープ）を描画して新しい元の音にし、波形ブロックをそれに置き換える。元の音は消さない
- 最適化して保存（`src/optimize.ts`）: 確定、使っていない元の音の部分を切る、使っていない元の音を消す、を選んで、整理したプロジェクトを保存する。開いているプロジェクトは書き換えない

## トラック
- サブトラックの音は親を通ってからマスターへ行く。子は親のすぐ後ろに並べる
- FX の列は WeVocal プラグイン（ホストは wevocal-lib の web/src/plugins/）。上から順に掛ける
- 重いプラグインを持つトラックは、再生位置より先に OfflineAudioContext で音を作っておく（`src/anticipate.ts`）。作った音は再生をまたいで取っておく（`src/fxCache.ts`）
- 先に作る方式を、同じプラグインを再生位置の少し先で途切れずに動かし続ける形（REAPER と同じ考え方）に移している途中。Worker の中に AudioWorklet の環境の代わりを置き、processor 方式のプラグインを 128 サンプルずつ直接呼ぶ（wevocal-lib の `plugins/stream/processorShim.ts`）。プラグインの形式ごとの見込みは次のとおり
  - wevocal の processor: 対象（SDK の見本の processor がそのまま動くことをテストで確かめている）
  - VST: 対象。つなぎ（vstbridge）は AudioWorklet 用に加工した processor で、中身は wasm と JavaScript だけなので、Worker でもそのまま動く（手元の VST2 の DLL で確かめた）。外したプロセッサーの VST は Worker の中の置き場に戻し、次に作るプロセッサーが使い回す
  - WAM: SDK が AudioContext ごとにホストを作り、自分でノードを作るので、Worker では動かせない。今の OfflineAudioContext の方式のままにする
- フリーズ（`src/freeze.ts`）は、トラックの波形ブロックの音を書き出して元の音として足し、波形ブロックの代わりに鳴らす

## プロジェクトのタブ
表示している 1 つだけが画面の状態（文書、保存の印、上書き先、編集位置、表示）を持ち、ほかのタブは記録（`TabRecord`）に退避する（`src/projectTabs.ts`）。切り替えは、今の状態を退避し、選んだ記録を戻す。元に戻す、やり直す、選択はタブをまたがない。

## 保存

| 対象 | 仕組み |
| --- | --- |
| プロジェクト | .wvst（[プロジェクトファイルの形式](PROJECT_FORMAT.md)）。保存先の選択と最近使用したファイル（Chrome、Edge）は PevenMUI のファイルの読み書き（`configureFileAccess`、`useRecentFiles`）を使う（`useProjectFile.ts`） |
| 自動保存 | IndexedDB。元の音は書き換えないので 1 回だけ書き、メタ（トラック、波形ブロック）は変更から 0.5 秒待って書く。書き込みと読み出しは Worker（`src/storage/autosave.ts`、`autosaveWorker.ts`）。タブごとに保存し、次に開いたときに復元する |
| 指定フォルダーへの写し | 設定で選んだフォルダーにも自動保存を写す（`src/storage/dataFolder.ts`。PevenMUI の `createDataFolder`） |
| 設定 | localStorage（`wevocalstudio.settings`） |
| WeVocalSynth へ | 「WeVocalSynth のプロジェクトに書き出す」で、トラックごとに描画した音を .wvsp にする |
