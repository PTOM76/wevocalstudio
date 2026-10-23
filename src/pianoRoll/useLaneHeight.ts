// 下のレーン（強さ、ピッチベンド、CC）の帯の高さ。0 なら隠す。覚えておいて、次に開いたときも同じ高さにする
import { useState } from 'react'
import { VEL, VEL_MAX } from './view'

const KEY = 'studio.rollLane'

export function useLaneHeight(): [number, (h: number) => void] {
  const [height, setHeight] = useState(() => {
    try {
      return Math.max(0, Math.min(VEL_MAX, Number(localStorage.getItem(KEY) ?? VEL)))
    } catch {
      return VEL
    }
  })
  const set = (h: number) => {
    setHeight(h)
    try {
      localStorage.setItem(KEY, String(h))
    } catch {
      // 保存できなくても使う
    }
  }
  return [height, set]
}
