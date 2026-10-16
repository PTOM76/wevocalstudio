// 時間軸に出すオートメーションのレーン（トラックとマスターに重ねて描く折れ線）。位置の計算、描画、点を押したかの判定。画面を知らない
import { findPlugin, migrateValues, paramToFrac, type AutoPoint, type ParamDef } from 'wevocal-lib'
import { MASTER, RULER, TOP, trackTop } from './drawTimeline'
import { trackHeight, type AutoLane, type Project } from './project'

/** 出しているレーン 1 本の、位置と中身 */
export interface LaneGeom {
  /** トラックの id か 'master' */
  target: string
  lane: AutoLane
  def: ParamDef
  /** 点（曲の頭からの秒と値） */
  points: AutoPoint[]
  /** 点がないときの一定の値 */
  base: number
  /** レーンの上端と高さ（内容の座標。トラックの行は縦のスクロールを引く前） */
  top: number
  h: number
}

/** 出す点の一辺（px） */
const DOT = 6

function describe(p: Project, target: string, lane: AutoLane | undefined, top: number, h: number): LaneGeom | null {
  if (!lane) return null
  const fx = target === 'master' ? p.master.fx : p.tracks.find((t) => t.id === target)?.fx
  const slot = fx?.[lane.slot]
  const plugin = slot && findPlugin(slot.plugin)
  const def = plugin?.manifest.params.find((d) => d.id === lane.param)
  if (!slot || !plugin || !def) return null
  const base = migrateValues(plugin.manifest, slot.values)[def.id] ?? def.default
  return { target, lane, def, points: slot.auto?.[def.id] ?? [], base, top: top + 2, h: h - 5 }
}

/** 内容の座標 y（トラックの行は縦のスクロールを足したもの）の位置に出ているレーン */
export function laneAt(p: Project, y: number): LaneGeom | null {
  if (y >= RULER && y < TOP) return describe(p, 'master', p.master.autoLane, RULER, MASTER)
  const i = p.tracks.findIndex((_, k) => y >= trackTop(p, k) && y < trackTop(p, k) + trackHeight(p.tracks[k]))
  return i < 0 ? null : describe(p, p.tracks[i].id, p.tracks[i].autoLane, trackTop(p, i), trackHeight(p.tracks[i]))
}

/** 出しているレーンすべて（描画用） */
export function allLanes(p: Project): LaneGeom[] {
  const list = [describe(p, 'master', p.master.autoLane, RULER, MASTER), ...p.tracks.map((t, i) => describe(p, t.id, t.autoLane, trackTop(p, i), trackHeight(t)))]
  return list.filter((x): x is LaneGeom => !!x)
}

/** レーンの縦の位置（値から） */
export const laneY = (l: LaneGeom, v: number) => l.top + paramToFrac(l.def, v) * l.h

/** 押した所にある点の番号（なければ -1）。x は画面の x、scroll と pps は時間軸の表示 */
export function hitAutoPoint(l: LaneGeom, x: number, y: number, scroll: number, pps: number): number {
  return l.points.findIndex((pt) => Math.hypot((pt.t - scroll) * pps - x, laneY(l, pt.v) - y) < 7)
}

/** レーンを描く。編集中（edit）は濃く、点を出す。そうでなければ薄い線だけ */
export function drawLanes(g: CanvasRenderingContext2D, p: Project, scroll: number, pps: number, width: number, vscroll: number, edit: boolean) {
  for (const l of allLanes(p)) {
    // トラックの行は縦にスクロールする。マスターは固定
    const dy = l.target === 'master' ? 0 : -vscroll
    const tx = (t: number) => (t - scroll) * pps
    const ys = (v: number) => laneY(l, v) + dy
    g.save()
    g.beginPath()
    // トラックの行は、目盛りとマスターの下にだけ描く
    const y0 = l.target === 'master' ? l.top : Math.max(l.top + dy, TOP)
    const h = l.top + dy + l.h - y0
    if (h <= 0) {
      g.restore()
      continue
    }
    g.rect(0, y0, width, h)
    g.clip()
    g.strokeStyle = '#ec407a'
    g.fillStyle = '#ec407a'
    g.lineWidth = edit ? 2 : 1.25
    g.globalAlpha = edit ? 1 : 0.55
    g.beginPath()
    if (l.points.length) {
      g.moveTo(0, ys(l.points[0].v))
      for (const pt of l.points) g.lineTo(tx(pt.t), ys(pt.v))
      g.lineTo(width, ys(l.points[l.points.length - 1].v))
    } else {
      g.moveTo(0, ys(l.base))
      g.lineTo(width, ys(l.base))
    }
    g.stroke()
    if (edit) for (const pt of l.points) g.fillRect(tx(pt.t) - DOT / 2, ys(pt.v) - DOT / 2, DOT, DOT)
    g.restore()
  }
}
