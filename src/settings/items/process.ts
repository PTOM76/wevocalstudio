// 「ピッチ」と時間軸の線の項目
import type { Algorithm } from 'wevocal-lib'
import type { StemModel, VocalModel } from 'wevocalextractor/host'
import type { GridDivision, GridMode } from '../../grid'
import { check, choice, defineItems, value } from './define'

/** 「ピッチ」 */
export const pitch = defineItems('pitch', {
  // 新しい波形ブロックのピッチの処理方式（WeVocalSynth と同じ。既定は Synth の声と同じ Vesola）。設定画面は自前の行
  algorithm: value<Algorithm>('sola3', { label: 'settings.algorithm' }),
  // 従来の処理方式（改良版があるもの）も一覧に表示する（WeVocalSynth と同じ）
  showLegacyAlgorithms: check(false, { label: 'settings.showLegacyAlgorithms', help: 'settings.showLegacyAlgorithmsHelp' }),
  // 新しい波形ブロックでフォルマント（声の響き）を保つか
  preserveFormant: check(true, { label: 'settings.preserveFormant' }),
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
