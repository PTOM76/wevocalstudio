// 音量メーター（wevocal-lib の部品にテーマの色を渡す。WeVocalSynth と同じ）
import { useMemo, type ComponentProps } from 'react'
import { canvasPixelRatio, usePalette } from 'pevenmui'
import { LevelMeter as Meter } from 'wevocal-lib/react'

/** 音量メーター（wevocal-lib）。色はテーマから、解像度は画面の倍率から渡す */
export default function LevelMeter(p: Omit<ComponentProps<typeof Meter>, 'colors' | 'pixelRatio'>) {
  const { pal } = usePalette()
  const colors = useMemo(() => ({ low: pal.success.main, mid: pal.warning.main, high: pal.error.main }), [pal])
  return <Meter {...p} colors={colors} pixelRatio={canvasPixelRatio} />
}
