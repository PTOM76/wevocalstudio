// 形状の選択肢（メニュー、ダイアログ、フェードで共通）。名前と、見本図に使う張り具合
import type { MessageKey } from './i18n'
import type { EnvShape } from './envelopeCurve'

/** 形状、名前の訳文のキー、見本図の張り具合（bezier だけ） */
export const SHAPE_CHOICES: readonly [EnvShape, MessageKey, number?][] = [
  ['linear', 'glide.shapeLinear'],
  ['square', 'glide.shapeSquare'],
  ['slowStartEnd', 'glide.shapeSlowStartEnd'],
  ['fastStart', 'glide.shapeFastStart'],
  ['fastEnd', 'glide.shapeFastEnd'],
  ['bezier', 'glide.shapeBezier', 0.6],
]

export const isEnvShape = (v: unknown): v is EnvShape => SHAPE_CHOICES.some(([s]) => s === v)
