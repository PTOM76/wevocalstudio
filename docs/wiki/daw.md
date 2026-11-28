# ほかの DAW とのやり取り
REAPER のプロジェクトと DAWproject の書き出しと読み込み。

REAPER のプロジェクトと DAWproject（Bitwig Studio、Studio One などが対応する形式）を書き出し、読み込める。

## 書き出し

「ファイル」→「ほかのアプリに書き出す」→「REAPER のプロジェクト…」か「DAWproject…」を選ぶ。REAPER は .rpp と音声を zip にまとめ、DAWproject は .dawproject に保存する。

| 項目 | 内容 |
| --- | --- |
| 波形ブロックの渡し方 | 「元の音で渡し、ピッチや速度は設定値にする」（既定）、「加工したブロックだけ描画する」、「すべて描画する」。元の音で渡すと、相手の DAW で編集しやすいが、処理方式の違いで音は少し変わる |
| FX も書き出す | REAPER のみ。VST はつまみの値ごと書く。組み込みの FX は REAPER の FX にする |

書き出すもの:

- トラック（名前、音量、パン、ミュート、ソロ、位相の反転）。サブトラックはフォルダー（DAWproject は入れ子のトラック）にする
- 波形ブロックの位置、長さ、元の音の開始位置、速度、ピッチ、音量、フェード、ピッチと音量のエンベロープ（ピッチカーブはエンベロープの点にする）
- MIDI ブロックの音符、CC、ピッチベンド（DAWproject は音符のみ）
- テンポ、拍子、途中のテンポの変化、マーカー
- 処理方式（REAPER のみ）。声向けの方式は élastique Soloist、それ以外は élastique Pro にする

組み込みの FX は、設定の「ファイル」の「組み込みの FX の変換先」で、Rea 系の VST と JSFX のどちらを先に使うかを選ぶ（既定は Rea 系）。先に選んだ方に対応するものが無ければ、もう一方にする。

| 組み込みの FX | Rea 系の VST | JSFX |
| --- | --- | --- |
| WevEQ | ReaEQ | なし |
| コンプ | ReaComp | Major Tom Compressor |
| リバーブ | ReaVerbate | なし |
| ゲート | ReaGate | Downward Expander |
| ディレイ | ReaDelay | Delay |
| ピッチ | ReaPitch | Pitch Shifter 2 |
| リミッター | ReaLimit | MGA JS Limiter |
| コーラス、アンサンブル | なし | Chorus |
| ディストーション | なし | Distortion |
| ディエッサー | なし | De-esser |
| フィルター | なし | RBJ Highpass/Lowpass Filters（ハイパスとローパスのみ） |

変換先に無いつまみ（リバーブの部屋の種類など）は反映されない。

## 読み込み

.rpp、.dawproject、またはそれらを入れた zip を開くと、新しいプロジェクトのタブで開く。.rpp と一緒に音声ファイルを選ぶと、その音声を使う。

- 音声は、zip の中か、一緒に選んだファイルから、パスと名前で探す
- 見つからない音声は無音の仮の音になり、「不足している音声」が表示される。「フォルダーから探す…」で .rpp のあるフォルダーを選ぶと、サブフォルダーも含めてまとめて探す。1 つずつファイルを選ぶこともできる。あとからは「ブロック」→「不足している音声を割り当てる…」で開く
- FX は、導入済みの VST、ReaEQ、上の表の Rea 系の VST と JSFX を、組み込みの FX か VST にして読み込む。読み込めない FX とアイテムの数は、開いたときに表示される
- REAPER のアイテムのピッチの処理方式は、設定の「ファイル」の「REAPER のピッチの処理方式」で、種類（Soloist、Pro、Efficient、そのほか）ごとに処理方式とフォルマントを決める。既定は、Soloist が Vesola でフォルマントを保ち、Pro と Efficient が Phasera v2 でフォルマントを保たない
