// プロジェクトの状態と操作（読み込み、マスター、トラック、波形ブロックの変更）と、元に戻す、やり直す
import { useCallback, useRef, useState } from 'react'
import { useHistory } from 'wevocal-lib/react'
import { ProjectDocument } from './document/ProjectDocument'
import { keepFrozen } from './freeze'
import { decodeFile, historySteps, type Clip, type Range } from 'wevocal-lib'
import { defaultInstrument } from './midiImport'
import * as edit from './document/edits/blocks'
import * as projectEdit from './document/edits/project'
import * as trackEdit from './document/edits/tracks'
import { BLOCK_LIMITS, midiBlocks, fitBlock, newBlock, subtreeEnd, newId, newProject, newTrack, type Block, type Marker, type Master, type MidiBlock, type PitchDefaults, type Source, type Tempo, type Track } from './project'

/** 置く場所（トラックと時刻）。省略したときは空いているトラックか、新しいトラック */
export interface DropAt {
  track: string
  start: number
}

/** ファイルをデコードする。失敗したら、どのファイルかがわかるよう名前を付けて投げる（ブラウザの EncodingError だけでは見分けられない） */
async function decodeNamed(file: File): Promise<Clip> {
  try {
    return await decodeFile(file)
  } catch (e) {
    throw new Error(`${file.name}: ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`)
  }
}

export function useProject(defaults: PitchDefaults & { historyLimit: number; defaultFade: number; defaultBpm: number }) {
  // 元に戻せる回数（設定）。文書は 1 つだけ作り、設定が変わっても最新の値を読む
  const limit = useRef(defaults.historyLimit)
  limit.current = defaults.historyLimit
  const [doc] = useState(() => new ProjectDocument(newProject(defaults.defaultBpm), { limit: () => limit.current, guard: keepFrozen }))
  const history = useHistory(doc.store)
  // 読み込みの途中で設定が変わっても、最新の既定値を使う
  const defaultsRef = useRef(defaults)
  defaultsRef.current = defaults
  // 範囲のドラッグや、続けての範囲の変更は、履歴の 1 段にまとめる
  const setRange = useCallback((r: Range | null) => doc.selectRange(r, 'range'), [doc])
  const { change, select, selectTracks, selectRange, endMerge, cancelMerge, undo, redo, goto, replace, setFxState } = doc

  /** 録った音を、指定したトラックの start 秒に波形ブロックとして置く */
  const addClip = useCallback(
    (clip: Clip, name: string, track: string, start: number) => {
      const source: Source = { id: newId(), name, clip, duration: clip.channels[0].length / clip.sampleRate }
      change((p) => ({ ...p, sources: [...p.sources, source], blocks: [...p.blocks, newBlock(track, source, start, defaultsRef.current, defaultsRef.current.defaultFade)] }))
    },
    [change],
  )

  /** ピッチカーブとピッチのエンベロープは元の音の時刻で持つので、元の音の頭が変わったらずらす */
  const shiftSourceTime = (b: Block, d: number): Partial<Block> => ({
    curve: b.curve && { ...b.curve, from: b.curve.from + d },
    pitchEnvelope: b.pitchEnvelope?.map((pt) => ({ ...pt, s: pt.s + d })),
  })

  /**
   * 分けた音（ボーカル抽出など）を、元の波形ブロックのトラックのすぐ下に、1 つずつ新しいトラックとして並べる（履歴は 1 段）。
   * 分けた音は波形ブロックの範囲（元の音の offset から）だけなので、元の音の開始位置は 0 にし、位置、速度、ピッチなどは元の値を写す
   */
  const addStems = useCallback(
    (blockId: string, stems: { name: string; clip: Clip }[]) =>
      change((p) => {
        const b = p.blocks.find((x) => x.id === blockId)
        if (!b) return p
        const sources: Source[] = stems.map((st) => ({ id: newId(), name: st.name, clip: st.clip, duration: st.clip.channels[0].length / st.clip.sampleRate }))
        // 元のトラックと同じ親の下に置く（サブトラックの並びを崩さない）
        const parent = p.tracks.find((tr) => tr.id === b.track)?.parent
        const tracks = stems.map((st) => ({ ...newTrack(0), name: st.name, parent }))
        // 元のトラックの子孫（サブトラック）の後ろ
        const at = subtreeEnd(p, p.tracks.findIndex((tr) => tr.id === b.track))
        return {
          ...p,
          sources: [...p.sources, ...sources],
          tracks: [...p.tracks.slice(0, at), ...tracks, ...p.tracks.slice(at)],
          blocks: [...p.blocks, ...sources.map((src, i) => ({ ...b, id: newId(), track: tracks[i].id, source: src.id, offset: 0, ...shiftSourceTime(b, -b.offset) }))],
        }
      }),
    [change],
  )

  /** 選んだ波形ブロックに、プロパティで変えた値をまとめて掛ける。`add` はブロックごとの今の値に足す分（混在の欄の +1 など）。速度を変えてもブロックの長さは変えない（使う元の音の範囲が変わる）。元の音の長さに収める */
  const editBlocks = useCallback(
    (ids: string[], edit: Partial<Block>, add: Partial<Record<keyof typeof BLOCK_LIMITS, number>> = {}) =>
      change((p) => ({
        ...p,
        blocks: p.blocks.map((b) => {
          if (!ids.includes(b.id)) return b
          const next = { ...b, ...edit }
          for (const [k, d] of Object.entries(add) as [keyof typeof BLOCK_LIMITS, number][]) {
            const [min, max] = BLOCK_LIMITS[k]
            next[k] = Math.max(min, Math.min(max, b[k] + d))
          }
          // 元の音を変えたら、ピッチカーブは合わなくなるので外す
          if (edit.source && edit.source !== b.source) next.curve = undefined
          const source = p.sources.find((s) => s.id === next.source)
          return source ? fitBlock(next, source.duration) : next
        }),
      })),
    [change],
  )

  /** ファイルを読み込んで、選んだ波形ブロックの元の音にする */
  const replaceSource = useCallback(
    async (ids: string[], file: File) => {
      const clip = await decodeNamed(file)
      const source: Source = { id: newId(), name: file.name, clip, duration: clip.channels[0].length / clip.sampleRate }
      change((p) => ({
        ...p,
        sources: [...p.sources, source],
        blocks: p.blocks.map((b) => (ids.includes(b.id) ? fitBlock({ ...b, source: source.id, curve: undefined }, source.duration) : b)),
      }))
    },
    [change],
  )

  /** 新しいトラックを足して、その id を返す */
  const addTrackNow = useCallback(() => {
    const track = newTrack(0)
    change((p) => ({ ...p, tracks: [...p.tracks, { ...track, name: `Track ${p.tracks.length + 1}` }] }))
    return track.id
  }, [change])

  /** ファイルを読み込んで波形ブロックとして置く。場所を指定したら、そのトラックに続けて並べる */
  const addFiles = useCallback(
    async (files: File[], at?: DropAt) => {
      let start = at?.start ?? 0
      const added: Source[] = []
      for (const file of files) {
        const clip = await decodeNamed(file)
        const source: Source = { id: newId(), name: file.name, clip, duration: clip.channels[0].length / clip.sampleRate }
        added.push(source)
        const name = file.name.replace(/\.[^.]+$/, '')
        const begin = start
        change((p) => trackEdit.placeSource(p, source, name, at?.track, begin, defaultsRef.current, defaultsRef.current.defaultFade))
        if (at) start += source.duration
      }
      return added
    },
    [change],
  )

  const addTrack = useCallback(
    (after?: string | null) => {
      const track = newTrack(0)
      change((p) => trackEdit.addTrackAfter(p, track, after))
      return track.id
    },
    [change],
  )

  /** トラックを波形ブロックごと写して、すぐ下に置く */
  const duplicateTrack = useCallback((id: string) => change((p) => trackEdit.duplicateTrack(p, id)), [change])

  /** トラックの写しを、after のすぐ下（なければ一番下）に波形ブロックごと置き、新しい id を返す（貼り付け） */
  const insertTrack = useCallback(
    (track: Track, blocks: Block[], after: string | null) => {
      const copy = { ...track, id: newId(), armed: false }
      change((p) => trackEdit.insertTrack(p, copy, blocks, after))
      return copy.id
    },
    [change],
  )

  /** トラックとその波形ブロックを消す。使われなくなった元の音も消す */
  const removeTrack = useCallback((id: string) => change((p) => trackEdit.removeTrack(p, id)), [change])

  /** parent の子として、新しいトラックを親の子孫の一番後ろに足して id を返す（サブトラック） */
  const addSubtrack = useCallback(
    (parent: string) => {
      const track = newTrack(0)
      change((p) => trackEdit.addSubtrack(p, track, parent))
      return track.id
    },
    [change],
  )

  /** 上の同じ階層のトラックの中に入れる */
  const indentTrack = useCallback((id: string) => change((p) => trackEdit.indentTrack(p, id)), [change])

  /** 親の外に出す。子孫ごと、親の子孫の一番後ろへ動かす（並びを崩さないように） */
  const outdentTrack = useCallback((id: string) => change((p) => trackEdit.outdentTrack(p, id)), [change])

  /** トラックを指定のスロットに移動する。to は「この番号のトラックの前」（0～N） */
  const reorderTrack = useCallback((id: string, to: number) => change((p) => trackEdit.reorderTrack(p, id, to)), [change])

  /** マーカーを足す（同じ位置にあれば足さない）。名前は M1、M2… */
  const addMarker = useCallback((time: number) => change((p) => projectEdit.addMarker(p, time)), [change])
  const updateMarker = useCallback((id: string, patch: Partial<Marker>) => change((p) => projectEdit.patchMarker(p, id, patch)), [change])
  const removeMarker = useCallback((id: string) => change((p) => projectEdit.removeMarker(p, id)), [change])

  /** 曲の終わりを決める。null で自動に戻す */
  const setEnd = useCallback((time: number | null) => change((p) => projectEdit.setEnd(p, time)), [change])

  /** テンポを変える。MIDI ブロックは拍の位置を保つよう、位置と長さ（秒）を直す */
  const updateTempo = useCallback((patch: Partial<Tempo>, merge?: string) => change((p) => projectEdit.patchTempo(p, patch), merge), [change])

  const updateMaster = useCallback((patch: Partial<Master>, merge?: string) => change((p) => projectEdit.patchMaster(p, patch), merge), [change])

  const updateTrack = useCallback((id: string, patch: Partial<Track>, merge?: string) => change((p) => trackEdit.patchTrack(p, id, patch), merge), [change])

  /** 複数のトラックを一度に変える（選んだトラックをまとめて） */
  const updateTracks = useCallback((patches: Record<string, Partial<Track>>, merge?: string) => change((p) => trackEdit.patchTracks(p, patches), merge), [change])

  const updateBlock = useCallback((id: string, patch: Partial<Block>, merge?: string) => change((p) => edit.patchBlocks(p, { [id]: patch }), merge), [change])

  /** 複数の波形ブロックを一度に変える（まとめて動かすとき）。id → 変える値 */
  const updateBlocks = useCallback((patches: Record<string, Partial<Block>>, merge?: string) => change((p) => edit.patchBlocks(p, patches), merge), [change])

  const removeBlocks = useCallback((ids: string[]) => change((p) => edit.removeBlocks(p, ids)), [change])

  /** トラックの time 秒に、2 小節の空の MIDI ブロックを足す。音源がなければ標準のシンセを付ける。足したブロックの id（トラックがなければ null） */
  const addMidiAt = useCallback(
    (trackId: string | undefined, time: number): string | null => {
      if (!trackId) return null
      const id = newId()
      change((p) => edit.addEmptyMidi(p, id, trackId, time, defaultInstrument))
      return id
    },
    [change],
  )
  /** MIDI ブロックの写しを足す（コピーの貼り付け、複製）。足した id の一覧 */
  const insertMidi = useCallback(
    (blocks: MidiBlock[]) => {
      const copies = blocks.map((b) => ({ ...b, id: newId(), notes: b.notes.map((n) => ({ ...n, id: newId() })) }))
      change((p) => ({ ...p, midi: [...midiBlocks(p), ...copies] }))
      return copies.map((b) => b.id)
    },
    [change],
  )
  /** MIDI ブロックをまとめて変える（id → 変える項目） */
  const updateMidiBlocks = useCallback((patches: Record<string, Partial<MidiBlock>>, merge?: string) => change((p) => edit.patchMidiBlocks(p, patches), merge), [change])
  /** MIDI ブロックを足す */
  const addMidiBlock = useCallback((block: MidiBlock) => change((p) => edit.addMidiBlocks(p, [block])), [change])
  /** MIDI ブロックを変える（ドラッグ中は merge で 1 回分にまとめる） */
  const updateMidiBlock = useCallback((id: string, patch: Partial<MidiBlock>, merge?: string) => change((p) => edit.patchMidiBlocks(p, { [id]: patch }), merge), [change])

  /** 波形ブロックの写しを置き、新しい id を返す（複製、貼り付け）。元の音がもう無いものは置かない */
  const insertBlocks = useCallback(
    (blocks: Block[]) => {
      const copies = blocks.map((b) => ({ ...b, id: newId() }))
      change((p) => edit.insertBlocks(p, copies))
      return copies.map((b) => b.id)
    },
    [change],
  )

  /** ピッチを delta 半音だけ変える。delta が null なら 0 に戻す */
  const nudgePitch = useCallback((ids: string[], delta: number | null) => change((p) => edit.nudgePitch(p, ids, delta)), [change])

  /** 無音で区切り、音のある所だけを残す */
  const splitBySilence = useCallback((ids: string[]) => change((p) => edit.splitBySilence(p, ids, defaultsRef.current.defaultFade)), [change])

  /** 位置 t で分ける。ids が空なら、t にかかる波形ブロックを全部分ける */
  const split = useCallback((t: number, ids: string[] = []) => change((p) => edit.splitAt(p, t, ids, defaultsRef.current.defaultFade)), [change])

  return {
    project: history.present.project,
    selected: history.present.selected,
    select,
    /** 選んでいるトラック（複数）と、範囲。どちらも履歴に入る */
    selectedTracks: history.present.selectedTracks,
    selectTracks,
    range: history.present.range,
    selectRange,
    /** 範囲を変える。続けての変更（ドラッグ）は履歴の 1 段にまとめる */
    setRange,
    /** 操作履歴（古い順の名前と、今の位置） */
    steps: historySteps(history).map((s) => s.label),
    stepIndex: history.past.length,
    goto,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    undo,
    // プロジェクト全体への変更（範囲の編集など。名前は差分から付く）
    apply: change,
    redo,
    endMerge,
    cancelMerge,
    replace,
    addFiles,
    addClip,
    addStems,
    editBlocks,
    replaceSource,
    addTrackNow,
    addTrack,
    removeTrack,
    duplicateTrack,
    addMidiBlock,
    addMidiAt,
    insertMidi,
    updateMidiBlocks,
    updateMidiBlock,
    addSubtrack,
    indentTrack,
    outdentTrack,
    reorderTrack,
    insertTrack,
    updateTempo,
    addMarker,
    setEnd,
    setFxState,
    updateMarker,
    removeMarker,
    updateMaster,
    updateTrack,
    updateTracks,
    updateBlock,
    updateBlocks,
    removeBlocks,
    insertBlocks,
    nudgePitch,
    split,
    splitBySilence,
  }
}
