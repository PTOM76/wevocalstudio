// エンベロープの形状の見本図（メニューとダイアログで、形状を見た目で選べるようにする）
import { shapeProgress, type EnvShape } from './envelopeCurve'

/** 左下から右上へ、形状に従って進む線。square は最後に上がる段 */
export function ShapeIcon(p: { shape: EnvShape; tension?: number; size?: number }) {
  const size = p.size ?? 16
  const pad = 2
  const span = size - pad * 2
  const steps = 16
  const pts = p.shape === 'square'
    ? [[0, 0], [1, 0], [1, 1]]
    : Array.from({ length: steps + 1 }, (_, i) => [i / steps, shapeProgress(p.shape, i / steps, p.tension ?? 0)])
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${(pad + x * span).toFixed(1)} ${(pad + (1 - y) * span).toFixed(1)}`).join(' ')
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ width: size, height: size, flexShrink: 0 }} aria-hidden>
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}
