// REAPER のプロジェクト（.rpp。テキスト）を書く。音声は相対のパス（audio/…）で参照し、呼ぶ側が zip に一緒に入れる（memo/daw-exchange.md）
import { PPQ, type XMidi, type XProject, type XTrack } from './exchange'
import { fxLines } from './rppFx'
import { shapeToReaper, type XEnvPoint } from './reaperPitch'

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

  /** テイクのエンベロープ。PT 時刻 値 形 拍子 選択（ベジェは張り具合を後ろに足す） */
  const envelope = (name: string, pts: XEnvPoint[], value: (v: number) => number) => {
    open(name)
    line('ACT 1 -1')
    line('VIS 1 1 1')
    line('LANEHEIGHT 0 0')
    line('ARM 0')
    line('DEFSHAPE 0 -1 -1')
    for (const p of pts) line(`PT ${num(p.t)} ${num(value(p.v))} ${shapeToReaper(p.shape)} 0 0${p.shape === 'bezier' ? ` 0 ${num(p.tension ?? 0)}` : ''}`)
    close()
  }

  /** MIDI のアイテム。イベントは前のイベントからの tick で書き、最後に長さの分を置く（全部の音を止める CC 123） */
  const writeMidi = (m: XMidi) => {
    open('ITEM')
    line(`POSITION ${num(m.start)}`)
    line(`LENGTH ${num(m.length)}`)
    line(`MUTE ${m.mute ? 1 : 0} 0`)
    line(`NAME ${quote(m.name)}`)
    open('SOURCE MIDI')
    line(`HASDATA 1 ${PPQ} QN`)
    let at = 0
    for (const e of m.events) {
      line(`E ${e.tick - at} ${e.bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ')}`)
      at = e.tick
    }
    line(`E ${Math.max(0, m.ticks - at)} b0 7b 00`)
    close()
    close()
  }

  open('REAPER_PROJECT 0.1 "7.0" 0')
  line(`TEMPO ${num(p.bpm)} ${p.beatsPerBar} 4`)
  line(`MASTER_VOLUME ${num(dbToGain(p.master.volume))} ${num(p.master.pan)} -1 -1 1`)
  line(`MASTERMUTESOLO ${p.master.mute ? 1 : 0}`)
  // 途中のテンポの変化はテンポのエンベロープの点（四角の形 1。拍子は分子 + 分母 × 65536）
  if (p.tempos.length) {
    open('TEMPOENVEX')
    line('ACT 1 -1')
    line(`PT 0 ${num(p.bpm)} 1 ${p.beatsPerBar + 4 * 65536} 0 1`)
    for (const t of p.tempos) line(`PT ${num(t.time)} ${num(t.bpm)} 1 ${t.beatsPerBar + 4 * 65536} 0 1`)
    close()
  }
  p.markers.forEach((m, i) => line(`MARKER ${i + 1} ${num(m.time)} ${quote(m.name)} 0`))
  p.tracks.forEach((t, i) => {
    open('TRACK')
    line(`NAME ${quote(t.name)}`)
    line(`VOLPAN ${num(dbToGain(t.volume))} ${num(t.pan)} -1 -1 1`)
    line(`MUTESOLO ${t.mute ? 1 : 0} ${t.solo ? 2 : 0} 0`)
    line(`IPHASE ${t.invert ? 1 : 0}`)
    line(`ISBUS ${folderOf(p.tracks, i)}`)
    if (t.fx?.length) {
      open('FXCHAIN')
      line('SHOW 0')
      line('LASTSEL 0')
      line('DOCKED 0')
      for (const fx of t.fx)
        for (const l of fxLines(fx, quote)) {
          if (l === '>') close()
          else if (l.startsWith('<')) open(l.slice(1))
          else line(l.replace(/^ {2}/, ''))
        }
      close()
    }
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
      line(`PLAYRATE ${num(c.rate)} 1 ${num(c.pitch)} ${c.pitchMode ?? -1} 0 0.0025`)
      open('SOURCE WAVE')
      line(`FILE ${quote(c.file)}`)
      close()
      // テイクのエンベロープ（ピッチは半音、音量は倍率。点はアイテムの頭からの秒と形）
      if (c.pitchEnv?.length) envelope('PITCHENV', c.pitchEnv, (v) => v)
      if (c.volEnv?.length) envelope('VOLENV', c.volEnv, dbToGain)
      close()
    }
    for (const m of t.midi) writeMidi(m)
    close()
  })
  close()
  return out.join('\n') + '\n'
}
