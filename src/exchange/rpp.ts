// REAPER のプロジェクト（.rpp。テキスト）を書く。音声は相対のパス（audio/…）で参照し、呼ぶ側が zip に一緒に入れる（memo/daw-exchange.md）
import type { XProject, XTrack } from './exchange'

const dbToGain = (db: number) => (db <= -150 ? 0 : 10 ** (db / 20))
/** 数を短く書く（REAPER は小数点を . で読む） */
const num = (v: number) => (Number.isFinite(v) ? String(Math.round(v * 1e10) / 1e10) : '0')
/** 文字列を囲む。中に " があれば ' で、両方あれば ` で囲み、それも含めば ` を ' に変える */
function quote(s: string) {
  const t = s.replace(/[\r\n]+/g, ' ')
  if (!t.includes('"')) return `"${t}"`
  if (!t.includes("'")) return `'${t}'`
  return `\`${t.replace(/`/g, "'")}\``
}

/** フォルダーの印（ISBUS）。1 1 はフォルダーの親、2 -n は n 段のフォルダーを閉じる最後のトラック */
function folderOf(tracks: XTrack[], i: number): string {
  const delta = (tracks[i + 1]?.depth ?? 0) - tracks[i].depth
  if (delta > 0) return '1 1'
  if (delta < 0) return `2 ${delta}`
  return '0 0'
}

export function writeRpp(p: XProject): string {
  const out: string[] = []
  let depth = 0
  const line = (s: string) => out.push(`${'  '.repeat(depth)}${s}`)
  const open = (s: string) => {
    line(`<${s}`)
    depth++
  }
  const close = () => {
    depth--
    line('>')
  }

  open('REAPER_PROJECT 0.1 "7.0" 0')
  line(`TEMPO ${num(p.bpm)} ${p.beatsPerBar} 4`)
  line(`MASTER_VOLUME ${num(dbToGain(p.master.volume))} ${num(p.master.pan)} -1 -1 1`)
  line(`MASTERMUTESOLO ${p.master.mute ? 1 : 0}`)
  p.markers.forEach((m, i) => line(`MARKER ${i + 1} ${num(m.time)} ${quote(m.name)} 0`))
  p.tracks.forEach((t, i) => {
    open('TRACK')
    line(`NAME ${quote(t.name)}`)
    line(`VOLPAN ${num(dbToGain(t.volume))} ${num(t.pan)} -1 -1 1`)
    line(`MUTESOLO ${t.mute ? 1 : 0} ${t.solo ? 2 : 0} 0`)
    line(`IPHASE ${t.invert ? 1 : 0}`)
    line(`ISBUS ${folderOf(p.tracks, i)}`)
    for (const c of t.clips) {
      open('ITEM')
      line(`POSITION ${num(c.start)}`)
      line(`LENGTH ${num(c.length)}`)
      line(`FADEIN 1 ${num(c.fadeIn)} 0 1 0 0 0`)
      line(`FADEOUT 1 ${num(c.fadeOut)} 0 1 0 0 0`)
      line(`MUTE ${c.mute ? 1 : 0} 0`)
      line(`NAME ${quote(c.name)}`)
      line(`VOLPAN 1 0 ${num(dbToGain(c.gain))} -1`)
      line(`SOFFS ${num(c.offset)}`)
      // 速度、ピッチを保つ（1）、ピッチ（半音）
      line(`PLAYRATE ${num(c.rate)} 1 ${num(c.pitch)} -1 0 0.0025`)
      open('SOURCE WAVE')
      line(`FILE ${quote(c.file)}`)
      close()
      close()
    }
    close()
  })
  close()
  return out.join('\n') + '\n'
}
