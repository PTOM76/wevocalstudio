// 時間軸の canvas の座標の補助（押した所の座標、描画のバッファの大きさ）
/**
 * 時間軸（canvas）の中の座標。clientX、clientY から求める（offsetX、offsetY は、画面の拡大（CSS の zoom）や、iPad のタッチで、描いている座標とずれることがある）。
 * 見えている大きさ（getBoundingClientRect）と、描いている大きさの比で換算するので、拡大していても合う
 */
export function localPos(canvas: HTMLCanvasElement, e: { clientX: number; clientY: number }) {
  const r = canvas.getBoundingClientRect()
  const w = canvas.width / devicePixelRatio
  const h = canvas.height / devicePixelRatio
  return { x: ((e.clientX - r.left) * w) / (r.width || w), y: ((e.clientY - r.top) * h) / (r.height || h) }
}

/** canvas の大きさを画面の大きさ（デバイスピクセル）に合わせる。同じなら何もしない */
export function fitCanvas(canvas: HTMLCanvasElement, width: number, height: number) {
  const w = Math.round(width * devicePixelRatio)
  const h = Math.round(height * devicePixelRatio)
  if (canvas.width !== w) canvas.width = w
  if (canvas.height !== h) canvas.height = h
}
