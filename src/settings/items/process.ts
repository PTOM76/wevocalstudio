// 「ピッチ」と時間軸の線の項目
import type { Algorithm } from 'wevocal-lib'
import type { GridDivision, GridMode } from '../../grid'
import { check, choice, defineItems, value } from './define'

/** 「ピッチ」 */
export const pitch = defineItems('pitch', {
  // 新しい波形ブロックのピッチの処理方式（WeVocalSynth と同じ。既定は Synth の声と同じ Vesola）。設定画面は自前の行
  algorithm: value<Algorithm>('sola3', { label: 'settings.algorithm' }),
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
