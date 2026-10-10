// 追加機能を <出力先>/addons/ に作る（作る手順は extractor/scripts/addons.mjs。WeVocalSynth と同じもの）
//   node scripts/build-addons.mjs          … dist（npm run build の後に実行する。CI はこちら）
//   node scripts/build-addons.mjs public   … public（npm run dev でも使える）
//   node scripts/build-addons.mjs public extractor … 名前を並べると、その分だけ作る（extractor、models）
import { buildModelAddons, buildRuntimeAddons } from '../extractor/scripts/addons.mjs'

const OUT = `${process.argv[2] ?? 'dist'}/addons`
const ONLY = process.argv.slice(3)
const want = (group) => !ONLY.length || ONLY.includes(group)

// ボーカル抽出の実行環境（ONNX Runtime の wasm は gpu と cpu に分ける）と、モデル
if (want('extractor')) buildRuntimeAddons(OUT)
if (want('models')) buildModelAddons(OUT, '.cache/addon-models')
