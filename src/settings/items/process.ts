// 「処理」（ピッチの処理方式）と時間軸の線の項目
import type { Algorithm } from 'wevocal-lib'
import type { StemModel, VocalModel } from 'wevocalextractor/host'
import type { GridDivision, GridMode } from '../../grid'
import { check, choice, defineItems, number, value } from './define'
import { t } from '../../i18n'

/** 「処理」 */
export const pitch = defineItems('process', {
  // 新しい波形ブロックのピッチの処理方式（WeVocalSynth と同じ。既定は Synth の声と同じ Vesola）。設定画面は自前の行
  algorithm: value<Algorithm>('sola3', { label: 'settings.algorithm' }),
  // 従来の処理方式（改良版があるもの）も一覧に表示する（WeVocalSynth と同じ）
  showLegacyAlgorithms: check(false, { label: 'settings.showLegacyAlgorithms', help: 'settings.showLegacyAlgorithmsHelp' }),
  // 新しい波形ブロックでフォルマント（声の響き）を保つか
  preserveFormant: check(true, { label: 'settings.preserveFormant' }),
  // 重いプラグインを持つトラックの音を、再生位置より先に作って鳴らす（試験的。音を出すスレッドの負担が減り、音が途切れにくい。再生を始めるまで少し待つ）
  anticipativeFx: check(false, { label: 'settings.anticipativeFx', help: 'settings.anticipativeFxHelp' }),
  // 先に計算した音を、再生をまたいで取っておく量（MB。0 で取っておかない。memo/fx-cache.md）
  anticipativeCacheMb: number(256, { label: 'settings.anticipativeCacheMb', help: 'settings.anticipativeCacheMbHelp', min: 0, max: 2048, step: 64, unit: 'MB' }),
})

/** 「ピッチ」「テンポ」（名前と既定値は WeVocalSynth と同じ） */
export const analysis = defineItems('process', {
  // 解析の欄の F0 を探す音の範囲（Hz）
  f0MinHz: number(60, { label: 'settings.f0MinHz', min: 40, max: 400, step: 1, unit: 'Hz' }),
  f0MaxHz: number(1000, { label: 'settings.f0MaxHz', min: 200, max: 2000, step: 10, unit: 'Hz' }),
  // 「平らにする」の強さ（1 未満なら元の揺れを少し残す）
  flattenStrength: choice<number>(1, { label: 'settings.flattenStrength', help: 'settings.flattenStrengthHelp', values: [1, 0.75, 0.5, 0.25], format: (s) => Math.round(s * 100) + '%' }),
  // 音声を最初に読み込んだとき、テンポを自動解析して BPM と 1 拍目の位置を入れる
  autoTempo: check(true, { label: 'settings.autoTempo', help: 'settings.autoTempoHelp' }),
  // 新しいプロジェクトの BPM
  defaultBpm: number(120, { label: 'settings.defaultBpm', help: 'settings.defaultBpmHelp', min: 20, max: 300, step: 1, unit: 'BPM', round: (v) => Math.round(v * 100) / 100 }),
})

/** 時間軸の線（「編集」に出す） */
export const grid = defineItems('edit', {
  grid: choice<GridMode>('beats', {
    label: 'settings.grid',
    options: [
      ['beats', 'settings.gridBeats'],
      ['time', 'settings.gridTime'],
    ],
  }),
  // グリッドの細かさ（音符。1/1〜1/256。再生の欄で入れる）
  gridDivision: value<GridDivision>(4),
})

/** 「ボーカル抽出」（名前と既定値は WeVocalSynth と同じ） */
export const vocal = defineItems('vocal', {
  // 抽出のモデル。この端末で使えないモデルは、抽出のときに代わりのモデルを使う（設定画面は自前の行）
  vocalModel: value<VocalModel>('int8', { label: 'settings.vocalModel' }),
  // GPU（WebGPU）を使う。使えないモデルでは押せない（設定画面は自前の行）
  vocalGpu: value(true, { label: 'settings.vocalGpu', help: 'settings.vocalGpuHelp' }),
  // 約 11kHz より上を残す（既定は消す）
  vocalKeepHighBand: check(false, { label: 'settings.vocalKeepHighBand', help: 'settings.vocalKeepHighBandHelp' }),
  // CPU（wasm）で使うスレッドの数（0 は自動）と、抽出の wasm のメモリの上限（MB）
  vocalThreads: choice<number>(0, { label: 'settings.vocalThreads', help: 'settings.vocalThreadsHelp', values: [0, 1, 2, 4, 8], format: (n) => (n === 0 ? t('settings.vocalThreadsAuto') : String(n)) }),
  vocalMemoryMb: choice<number>(1024, { label: 'settings.vocalMemory', help: 'settings.vocalMemoryHelp', values: [256, 512, 1024, 2048, 4096], format: (mb) => (mb < 1024 ? `${mb} MB` : `${mb / 1024} GB`) }),
  // 楽器ごとに分けるモデル（Demucs。4 つか、ギターとピアノも分ける 6 つ）
  stemModel: choice<StemModel>('htdemucs', {
    label: 'settings.stemModel',
    help: 'settings.stemModelHelp',
    options: [
      ['htdemucs', 'addon.modelStems4'],
      ['htdemucs6s', 'addon.modelStems6'],
    ],
  }),
  // 楽器ごとに分けるとき、ボーカルをさらに主旋律とハモリに分ける
  // 一音ずつ切り出す前に、ボーカルを取り出す（伴奏があると精度が下がるため。WeVocalSynth と同じ）
  vocalBeforeAnalysis: check(false, { label: 'settings.vocalBeforeAnalysis', help: 'settings.vocalBeforeAnalysisHelp' }),
  stemChorus: check(false, { label: 'settings.stemChorus', help: 'settings.stemChorusHelp' }),
})
