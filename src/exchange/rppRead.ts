// REAPER のプロジェクト（.rpp）を読み、中間の形にする（memo/daw-exchange.md）。音声はファイルのパスのまま返し、中身は呼ぶ側が探す
import { PPQ, type XClip, type XMidi, type XProject, type XTrack } from './exchange'

/** RPP の 1 つのかたまり（<NAME 引数 … >）。lines は中の行（かたまり以外）を語に分けたもの */
interface Node {
  name: string
  args: string[]
  lines: string[][]
  children: Node[]
}

/** 1 行を語に分ける（"…"、'…'、`…` で囲んだものは 1 語） */
export function tokens(line: string): string[] {
  const out: string[] = []
  const s = line.trim()
  let i = 0
  while (i < s.length) {
    if (s[i] === ' ' || s[i] === '\t') {
      i++
      continue
    }
    const q = s[i]
    if (q === '"' || q === "'" || q === '`') {
      const end = s.indexOf(q, i + 1)
      out.push(s.slice(i + 1, end < 0 ? s.length : end))
      i = end < 0 ? s.length : end + 1
    } else {
      let end = i
      while (end < s.length && s[end] !== ' ' && s[end] !== '\t') end++
      out.push(s.slice(i, end))
      i = end
    }
  }
  return out
}

function parseTree(text: string): Node {
  const root: Node = { name: '', args: [], lines: [], children: [] }
  const stack = [root]
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const top = stack[stack.length - 1]
    if (line.startsWith('<')) {
      const [name, ...args] = tokens(line.slice(1))
      const node: Node = { name, args, lines: [], children: [] }
      top.children.push(node)
      stack.push(node)
    } else if (line === '>') {
      if (stack.length > 1) stack.pop()
    } else top.lines.push(tokens(line))
  }
  return root
}

const get = (n: Node, key: string) => n.lines.find((l) => l[0] === key)
const numAt = (l: string[] | undefined, i: number, def = 0) => {
  const v = l ? parseFloat(l[i]) : NaN
  return Number.isFinite(v) ? v : def
}
const gainToDb = (g: number) => (g <= 0 ? -60 : Math.max(-60, 20 * Math.log10(g)))

/** MIDI のかたまり（HASDATA と E の行）を、tick のイベントにする。tick は 4 分音符あたり PPQ にそろえる */
function readMidi(src: Node, item: Omit<XMidi, 'ticks' | 'events'>): XMidi {
  const has = get(src, 'HASDATA')
  const ppq = numAt(has, 2, PPQ) || PPQ
  const scale = PPQ / ppq
  const events: XMidi['events'] = []
  let at = 0
  for (const l of src.lines) {
    if (l[0] !== 'E' && l[0] !== 'e') continue
    at += parseInt(l[1], 10) || 0
    const bytes = l.slice(2, 5).map((b) => parseInt(b, 16))
    if (bytes.some((b) => !Number.isFinite(b))) continue
    // 全部の音を止める（CC 123）は長さの印なので除く
    if ((bytes[0] & 0xf0) === 0xb0 && bytes[1] === 123) continue
    events.push({ tick: Math.round(at * scale), bytes })
  }
  return { ...item, ticks: Math.round(at * scale), events }
}

/** 読めなかったものの数（呼ぶ側が知らせる） */
export interface ReadNotes {
  /** 音声と MIDI 以外のアイテム（サブプロジェクトなど） */
  skippedItems: number
}

export function readRpp(text: string): { project: XProject; notes: ReadNotes } {
  const root = parseTree(text).children.find((c) => c.name === 'REAPER_PROJECT')
  if (!root) throw new Error('not a REAPER project')
  const tempo = get(root, 'TEMPO')
  const bpm = numAt(tempo, 1, 120)
  const beatsPerBar = Math.round(numAt(tempo, 2, 4)) || 4
  const notes: ReadNotes = { skippedItems: 0 }

  // マーカー（区間は始まりだけ。旗 1 が区間）
  const markers: XProject['markers'] = []
  const regions = new Set<string>()
  for (const l of root.lines.filter((x) => x[0] === 'MARKER')) {
    const isRegion = (parseInt(l[4], 10) || 0) & 1
    if (isRegion && regions.has(l[1])) continue
    if (isRegion) regions.add(l[1])
    markers.push({ time: numAt(l, 2), name: l[3] ?? '' })
  }
  // 途中のテンポの変化（テンポのエンベロープの点。0 秒の点は最初のテンポ）
  const env = root.children.find((c) => c.name === 'TEMPOENVEX')
  const tempos: XProject['tempos'] = (env?.lines ?? [])
    .filter((l) => l[0] === 'PT' && numAt(l, 1) > 0)
    .map((l) => ({ time: numAt(l, 1), bpm: numAt(l, 2, bpm), beatsPerBar: (Math.round(numAt(l, 4)) & 0xffff) || beatsPerBar }))

  const mv = get(root, 'MASTER_VOLUME')
  const master = { volume: gainToDb(numAt(mv, 1, 1)), pan: numAt(mv, 2), mute: (numAt(get(root, 'MASTERMUTESOLO'), 1) & 1) === 1 }

  const tracks: XTrack[] = []
  let depth = 0
  for (const t of root.children.filter((c) => c.name === 'TRACK')) {
    const vp = get(t, 'VOLPAN')
    const ms = get(t, 'MUTESOLO')
    const clips: XClip[] = []
    const midi: XMidi[] = []
    for (const it of t.children.filter((c) => c.name === 'ITEM')) {
      const src = it.children.find((c) => c.name === 'SOURCE')
      const base = { name: get(it, 'NAME')?.[1] ?? '', start: numAt(get(it, 'POSITION'), 1), length: numAt(get(it, 'LENGTH'), 1), mute: numAt(get(it, 'MUTE'), 1) === 1 }
      // 中身が SECTION などで包まれていれば、その中の SOURCE を見る
      const inner = src?.children.find((c) => c.name === 'SOURCE') ?? src
      const file = inner && get(inner, 'FILE')?.[1]
      if (inner?.args[0] === 'MIDI') midi.push(readMidi(inner, base))
      else if (file) {
        const pr = get(it, 'PLAYRATE')
        clips.push({
          ...base,
          file,
          offset: numAt(get(it, 'SOFFS'), 1),
          gain: gainToDb(numAt(get(it, 'VOLPAN'), 3, 1)),
          fadeIn: numAt(get(it, 'FADEIN'), 2),
          fadeOut: numAt(get(it, 'FADEOUT'), 2),
          rate: numAt(pr, 1, 1) || 1,
          pitch: numAt(pr, 3),
        })
      } else notes.skippedItems++
    }
    tracks.push({ name: get(t, 'NAME')?.[1] ?? '', volume: gainToDb(numAt(vp, 1, 1)), pan: numAt(vp, 2), mute: numAt(ms, 1) === 1, solo: numAt(ms, 2) > 0, invert: numAt(get(t, 'IPHASE'), 1) === 1, depth, clips, midi })
    // フォルダーの印で、次のトラックの深さを決める
    const bus = get(t, 'ISBUS')
    const kind = numAt(bus, 1)
    if (kind === 1) depth++
    else if (kind === 2) depth = Math.max(0, depth + numAt(bus, 2))
  }
  return { project: { bpm, beatsPerBar, markers, tempos, master, tracks, files: new Map() }, notes }
}
