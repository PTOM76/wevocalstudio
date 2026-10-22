// ピアノロールを描く（鍵盤、グリッド、音符、再生位置、強さの帯）。画面の部品は持たない
import type { Note } from '../project'
import { BLACK, GAP, KEYS, NAMES, VEL, beatX, pitchY, rollHeight, rowsOf, type View } from './view'

/** 描くときの色（MUI のパレットから） */
export interface RollColors {
  background: string
  paper: string
  hover: string
  divider: string
  text: string
  textSecondary: string
  note: string
  noteSelected: string
  play: string
  /** 鍵盤の白鍵と黒鍵（テーマによらず白と黒） */
  whiteKey: string
  blackKey: string
  keyLine: string
}

export interface RollDraw {
  view: View
  notes: Note[]
  selected: string[]
  /** ブロックの長さ（拍） */
  len: number
  /** グリッドの間隔（拍） */
  step: number
  beatsPerBar: number
  /** スケールの音（0〜11。スケールの外の行を暗くする。なければ null） */
  scale: Set<number> | null
  /** 鳴っている音（その鍵盤を色付けする。なければ null） */
  pressed: number | null
  /** ステップ入力の位置（拍。ステップ入力でなければ null。点線で描く） */
  stepAt: number | null
  /** 再生位置（拍。再生していなければ null） */
  play: number | null
  box: { x0: number; y0: number; x1: number; y1: number } | null
  velLabel: string
  /** 曲線のレーン（CC、ピッチベンド）を描くとき。なければ強さの帯。lo、hi は値の範囲 */
  curve: { points: { t: number; v: number }[]; lo: number; hi: number; label: string } | null
  colors: RollColors
}

export function drawRoll(g: CanvasRenderingContext2D, o: RollDraw) {
  const { view: v, colors: c } = o
  const rows = rowsOf(v)
  const roll = rollHeight(v)
  g.fillStyle = c.background
  g.fillRect(0, 0, v.w, v.h)
  g.font = '10px Roboto, sans-serif'
  g.textBaseline = 'middle'
  // 行の色（黒鍵の行は少し暗く）
  for (let r = 0; r < rows; r++) {
    const pitch = v.low + rows - 1 - r
    if (BLACK.has(pitch % 12)) {
      g.fillStyle = c.hover
      g.fillRect(KEYS, r * v.row, v.w - KEYS, v.row)
    }
  }
  // スケールの外の行を暗くする
  if (o.scale) {
    g.fillStyle = 'rgba(0, 0, 0, 0.3)'
    for (let r = 0; r < rows; r++) if (!o.scale.has((v.low + rows - 1 - r) % 12)) g.fillRect(KEYS, r * v.row, v.w - KEYS, v.row)
  }
  // 鍵盤: 白鍵を敷いて、黒鍵を短く重ねる。黒鍵のない境目（E と F、B と C）と、黒鍵の真ん中に区切りの線
  const blackW = KEYS * 0.6
  g.fillStyle = c.whiteKey
  g.fillRect(0, 0, KEYS - 1, rollHeight(v))
  for (let r = 0; r < rows; r++) {
    const pitch = v.low + rows - 1 - r
    const y = r * v.row
    const black = BLACK.has(pitch % 12)
    const down = o.pressed === pitch
    if (black) {
      g.fillStyle = down ? c.noteSelected : c.blackKey
      g.fillRect(0, y, blackW, v.row - 1)
      g.fillStyle = c.keyLine
      g.fillRect(blackW, y + v.row / 2, KEYS - 1 - blackW, 1)
    } else {
      if (down) {
        g.fillStyle = c.noteSelected
        g.fillRect(0, y, KEYS - 1, v.row)
      }
      if (pitch % 12 === 4 || pitch % 12 === 11) {
        g.fillStyle = c.keyLine
        g.fillRect(0, y, KEYS - 1, 1)
      }
      // C は必ず、行が高ければほかの白鍵にも音名を書く
      if (pitch % 12 === 0 || v.row >= 16) {
        g.fillStyle = c.blackKey
        g.textAlign = 'right'
        g.fillText(`${NAMES[pitch % 12]}${Math.floor(pitch / 12) - 1}`, KEYS - 5, y + v.row / 2)
        g.textAlign = 'left'
      }
    }
  }
  g.fillStyle = c.divider
  g.fillRect(KEYS - 1, 0, 1, v.h)
  // 縦線（グリッド、拍、小節）。詰まりすぎるときは間引く
  let step = o.step
  while (step * v.ppb < 6) step *= 2
  const near = (b: number, unit: number) => Math.abs(b / unit - Math.round(b / unit)) < 1e-6
  for (let b = Math.ceil(v.left / step) * step; b <= o.len + 1e-6; b += step) {
    const x = beatX(v, b)
    if (x > v.w) break
    g.fillStyle = near(b, o.beatsPerBar) || near(b, 1) ? c.divider : c.hover
    g.fillRect(x, 0, 1, v.h)
  }
  // ブロックの終わり
  const end = beatX(v, o.len)
  if (end < v.w) {
    g.fillStyle = c.hover
    g.fillRect(end, 0, v.w - end, v.h)
  }
  // 音符（強さが弱いほど薄く）
  g.save()
  g.beginPath()
  g.rect(KEYS, 0, v.w - KEYS, roll)
  g.clip()
  for (const n of o.notes) {
    if (n.pitch < v.low || n.pitch >= v.low + rows) continue
    const x = beatX(v, n.t)
    const w = Math.max(3, n.dur * v.ppb)
    if (x + w < KEYS || x > v.w) continue
    const y = pitchY(v, n.pitch)
    g.globalAlpha = (0.4 + 0.6 * n.vel) * (n.mute ? 0.3 : 1)
    g.fillStyle = o.selected.includes(n.id) ? c.noteSelected : c.note
    g.fillRect(x, y + 1, w, v.row - 2)
    g.globalAlpha = 0.5
    g.fillStyle = c.text
    g.fillRect(x + w - 2, y + 1, 2, v.row - 2)
    g.globalAlpha = 1
  }
  g.restore()
  // 強さの帯
  const top = roll + GAP
  g.fillStyle = c.hover
  g.fillRect(KEYS, top, v.w - KEYS, VEL)
  g.fillStyle = c.textSecondary
  g.fillText(o.curve?.label ?? o.velLabel, 4, top + 10)
  if (o.curve) {
    const { points, lo, hi } = o.curve
    const yOf = (val: number) => top + VEL * (1 - (val - lo) / (hi - lo))
    // ピッチベンドは、真ん中（0）に線を引く
    if (lo < 0) {
      g.fillStyle = c.divider
      g.fillRect(KEYS, yOf(0), v.w - KEYS, 1)
    }
    g.save()
    g.beginPath()
    g.rect(KEYS, top, v.w - KEYS, VEL)
    g.clip()
    g.strokeStyle = c.note
    g.lineWidth = 1.5
    g.beginPath()
    points.forEach((pt, i) => (i ? g.lineTo(beatX(v, pt.t), yOf(pt.v)) : g.moveTo(beatX(v, pt.t), yOf(pt.v))))
    // 最後の点から先は、同じ値で続く
    if (points.length) g.lineTo(beatX(v, o.len), yOf(points[points.length - 1].v))
    g.stroke()
    g.fillStyle = c.noteSelected
    for (const pt of points) g.fillRect(beatX(v, pt.t) - 3, yOf(pt.v) - 3, 6, 6)
    g.restore()
  } else
    for (const n of o.notes) {
      const x = beatX(v, n.t)
      if (x < KEYS || x > v.w) continue
      g.fillStyle = o.selected.includes(n.id) ? c.noteSelected : c.note
      g.fillRect(x, top + VEL * (1 - n.vel), 3, VEL * n.vel)
    }
  if (o.stepAt !== null) {
    const x = beatX(v, o.stepAt)
    if (x >= KEYS && x <= v.w) {
      g.fillStyle = c.noteSelected
      for (let y = 0; y < v.h; y += 6) g.fillRect(x, y, 1.5, 3)
    }
  }
  if (o.play !== null) {
    const x = beatX(v, o.play)
    if (x >= KEYS && x <= v.w) {
      g.fillStyle = c.play
      g.fillRect(x, 0, 1, v.h)
    }
  }
  if (o.box) {
    g.strokeStyle = c.note
    g.strokeRect(Math.min(o.box.x0, o.box.x1), Math.min(o.box.y0, o.box.y1), Math.abs(o.box.x1 - o.box.x0), Math.abs(o.box.y1 - o.box.y0))
  }
}
