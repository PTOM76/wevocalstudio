// コマンドの表（操作の名前 → 実行と、押せるか）。キーの割り当て（keymap.ts）とメニューが、名前で呼ぶ
import { glueMidi } from '../midiLoop'
import { type Action } from '../keymap'
import { newId, midiBlocks } from '../project'
import { reverseBlocks } from '../reverse'
import { cropToRange, deleteRange, insertSilence, normalizeBlocks, rangeToNewTrack, repeatRange } from '../rangeEdit'
import type { Command, CommandEnv } from './types'

/** 今の選択と設定から、操作の表を組む */
export function buildCommands(env: CommandEnv): Record<Action, Command> {
  const { c, doc, selectedTrack, selectTrack, midiChosen, midiSel, chosen, ids, any, anyWave, canSplit, track, blockTrack, envBlocks, resetEnvelope, clipboard, midiClipboard, trackClipboard, copied: setCopied, paste, duplicate, nudge } = env
  return {
    playStop: { run: () => (c.playing ? c.stop() : c.play()) },
    stop: { run: c.stop },
    pause: { run: () => (c.playing ? c.pause() : c.play()) },
    repeat: { run: c.toggleRepeat },
    record: { run: c.toggleRecord },
    detectTempo: { enabled: doc.project.blocks.length > 0, run: c.detectTempo },
    toStart: { run: () => c.seek(0) },
    cursorLeft: { run: () => c.seek(Math.max(0, c.cursor - c.gridStep())) },
    cursorRight: { run: () => c.seek(c.cursor + c.gridStep()) },
    nudgeLeft: { enabled: any, run: () => nudge(-1) },
    nudgeRight: { enabled: any, run: () => nudge(1) },
    newProject: { run: c.newProject },
    addTrack: { run: () => selectTrack(doc.addTrack(selectedTrack)) },
    toEnd: { run: () => c.seek(doc.project.blocks.reduce((m, b) => Math.max(m, b.start + b.length), 0)) },
    snap: { run: c.toggleSnap },
    follow: { run: c.toggleFollow },
    envelope: { run: c.toggleEnvelope },
    pitchEnvelope: { run: c.togglePitchEnvelope },
    envelopeReset: { enabled: !!c.envKind && envBlocks.length > 0, run: () => c.envKind && resetEnvelope(c.envKind, envBlocks.map((b) => b.id)) },
    envelopeTool: { enabled: !!c.envKind, run: () => c.setEnvPen(!c.envPen) },
    autoEdit: { run: c.toggleAutoEdit },
    zoomIn: { run: () => c.zoom(1.5) },
    zoomOut: { run: () => c.zoom(1 / 1.5) },
    properties: { enabled: any, run: () => (anyWave ? c.openProperties(chosen[0].id) : midiSel && c.openDialog('midiProps', midiSel.id)) },
    addMarker: { run: () => doc.addMarker(c.cursor) },
    nextMarker: { run: () => { const m = doc.project.markers.find((m) => m.time > c.cursor + 1e-3); if (m) c.seek(m.time) } },
    prevMarker: { run: () => { const m = doc.project.markers.findLast((m) => m.time < c.cursor - 1e-3); if (m) c.seek(m.time) } },
    split: { enabled: canSplit, run: () => doc.split(c.cursor, [...ids, ...midiChosen.map((b) => b.id)]) },
    splitSilence: { enabled: anyWave, run: () => doc.splitBySilence(ids) },
    selectAll: { run: () => doc.select(doc.project.blocks.map((b) => b.id)) },
    // 範囲の両端で、かかっている波形ブロックを全部分ける
    splitRange: {
      enabled: !!doc.range,
      run: () => {
        if (!doc.range) return
        doc.split(doc.range.start)
        doc.split(doc.range.end)
      },
    },
    // 選択の解除（範囲と波形ブロック）
    clearRange: { enabled: !!doc.range || any, run: () => doc.apply((p) => p, undefined, { range: null, selected: [] }) },
    trimRange: { enabled: !!doc.range, run: () => doc.range && doc.apply((p) => cropToRange(p, doc.range!, c.defaultFade)) },
    deleteRange: { enabled: !!doc.range, run: () => doc.range && doc.apply((p) => deleteRange(p, doc.range!, c.defaultFade), undefined, { range: null }) },
    insertSilence: { enabled: !!doc.range, run: () => doc.range && (doc.apply((p) => insertSilence(p, doc.range!.start, doc.range!.end - doc.range!.start, c.defaultFade)), c.seekAfterInsert && c.moveCursor(doc.range.end)) },
    repeatRange: { enabled: !!doc.range, run: () => doc.range && doc.apply((p) => repeatRange(p, doc.range!, 1, newId, c.defaultFade)) },
    normalize: { enabled: anyWave, run: () => doc.apply((p) => normalizeBlocks(p, ids)) },
    copyRangeToTrack: { enabled: !!doc.range, run: () => doc.range && doc.apply((p) => rangeToNewTrack(p, doc.range!, false, selectedTrack, c.defaultFade)) },
    moveRangeToTrack: { enabled: !!doc.range, run: () => doc.range && doc.apply((p) => rangeToNewTrack(p, doc.range!, true, selectedTrack, c.defaultFade)) },
    reverse: { enabled: anyWave, run: () => doc.apply((p) => reverseBlocks(p, ids)) },
    bake: { enabled: anyWave, run: () => c.bake(ids) },
    // 分けるのは 1 つずつ（選んでいる最後のもの）
    synth: { run: () => c.openDialog('synth') },
    sampler: { enabled: anyWave, run: () => any && c.openDialog('sampler', ids[ids.length - 1]) },
    kanaCut: { enabled: anyWave, run: () => any && c.openDialog('kanaCut', ids[ids.length - 1]) },
    addMidiBlock: {
      run: () => {
        const id = doc.addMidiAt(selectedTrack ?? doc.project.tracks[0]?.id, c.cursor)
        if (id) doc.select([id])
      },
    },
    importMidi: { run: c.importMidi },
    glueMidi: { enabled: midiChosen.length > 1, run: () => doc.apply((q) => glueMidi(q, midiChosen.map((b) => b.id))) },
    exportMidi: { enabled: midiBlocks(doc.project).length > 0, run: () => c.exportMidi(midiChosen.map((b) => b.id)) },
    pluginTool: { run: () => c.openDialog('tool') },
    pluginAnalyze: { run: () => c.openDialog('analyze') },
    editMidi: { enabled: !!midiSel, run: () => midiSel && c.openDialog('pianoRoll', midiSel.id) },
    // 選んでいるトラック。なければ選んでいるブロックのトラック（ブロックを Ctrl や複数選択すると、トラックの選択が外れるため）
    trackInstrument: { enabled: !!(track ?? blockTrack), run: () => (track ?? blockTrack) && c.openDialog('instrument', (track ?? blockTrack)!.id) },
    splitVocals: { enabled: anyWave, run: () => any && c.extract.vocals(ids[ids.length - 1]) },
    splitLead: { enabled: anyWave, run: () => any && c.extract.lead(ids[ids.length - 1]) },
    splitInstruments: { enabled: anyWave, run: () => any && c.extract.instruments(ids[ids.length - 1]) },
    splitVoicesByPitch: { enabled: anyWave, run: () => any && c.extract.voices(ids[ids.length - 1], 'pitch') },
    splitVoicesByVolume: { enabled: anyWave, run: () => any && c.extract.voices(ids[ids.length - 1], 'volume') },
    showAll: { enabled: c.end > 0, run: () => c.fit(0, c.end) },
    zoomRange: { enabled: !!doc.range || anyWave, run: () => (doc.range ? c.fit(doc.range.start, doc.range.end) : c.fit(Math.min(...chosen.map((b) => b.start)), Math.max(...chosen.map((b) => b.start + b.length)))) },
    playRange: { enabled: !!doc.range, run: () => doc.range && c.playAt(doc.range.start) },
    renameTrack: { enabled: !!selectedTrack, run: () => selectedTrack && c.openDialog('renameTrack', selectedTrack) },
    duplicateTrack: { enabled: !!selectedTrack, run: () => selectedTrack && doc.duplicateTrack(selectedTrack) },
    muteTrack: { enabled: !!track, run: () => track && doc.updateTracks(Object.fromEntries((doc.selectedTracks.includes(track.id) ? doc.selectedTracks : [track.id]).map((id) => [id, { mute: !track.mute }]))) },
    soloTrack: { enabled: !!track, run: () => track && doc.updateTracks(Object.fromEntries((doc.selectedTracks.includes(track.id) ? doc.selectedTracks : [track.id]).map((id) => [id, { solo: !track.solo }]))) },
    clearMarkers: { enabled: doc.project.markers.length > 0, run: () => doc.apply((p) => ({ ...p, markers: [] })) },
    // 波形ブロックか MIDI ブロックを選んでいればそれを、選んでいなければ選んでいるトラックを（元に戻せる）
    delete: {
      enabled: any || !!selectedTrack,
      run: () => {
        if (any) {
          doc.removeBlocks([...ids, ...midiChosen.map((b) => b.id)])
          doc.select([])
        } else if (selectedTrack) {
          doc.removeTrack(selectedTrack)
          selectTrack(null)
        }
      },
    },
    undo: { enabled: doc.canUndo, run: doc.undo },
    redo: { enabled: doc.canRedo, run: doc.redo },
    // 切り取り（コピーしてから消す）
    cut: {
      enabled: any,
      run: () => {
        clipboard.current = chosen
        midiClipboard.current = midiChosen
        trackClipboard.current = null
        setCopied()
        doc.removeBlocks([...ids, ...midiChosen.map((b) => b.id)])
        doc.select([])
      },
    },
    copy: {
      enabled: any || !!selectedTrack,
      run: () => {
        // 波形ブロックを選んでいればそれ、なければ選んでいるトラックを波形ブロックごと
        const track = !any ? doc.project.tracks.find((t) => t.id === selectedTrack) : undefined
        trackClipboard.current = track ? { track, blocks: doc.project.blocks.filter((b) => b.track === track.id) } : null
        clipboard.current = track ? [] : chosen
        midiClipboard.current = track ? [] : midiChosen
        setCopied()
      },
    },
    paste: { enabled: clipboard.current.length > 0 || midiClipboard.current.length > 0 || !!trackClipboard.current, run: () => paste() },
    duplicate: { enabled: any, run: duplicate },
    open: { run: c.openFile },
    // 上限に達していれば知らせる（設定の「同時に開くウィンドウの数」。WeVocalSynth と同じ）
    newWindow: { run: c.newWindow },
    save: { run: c.save },
    saveAs: { run: c.saveAs },
    saveRangeToFolder: { enabled: !!c.folder && !!doc.range, run: () => c.folder?.saveRange() },
    saveBlocksToFolder: { enabled: !!c.folder && any, run: () => c.folder?.saveBlocks(ids) },
    import: { run: c.importFiles },
    saveOptimized: { enabled: doc.project.blocks.length > 0, run: c.saveOptimized },
    export: { enabled: doc.project.blocks.length > 0, run: c.openExport },
    exportVideo: { enabled: doc.project.blocks.length > 0, run: c.exportVideo },
    exportWvsp: { enabled: doc.project.blocks.length > 0, run: c.exportWvsp },
    pitchUp: { enabled: anyWave, run: () => doc.nudgePitch(ids, 1) },
    pitchDown: { enabled: anyWave, run: () => doc.nudgePitch(ids, -1) },
    pitchUpFine: { enabled: anyWave, run: () => doc.nudgePitch(ids, 0.1) },
    pitchDownFine: { enabled: anyWave, run: () => doc.nudgePitch(ids, -0.1) },
    pitchReset: { enabled: anyWave, run: () => doc.nudgePitch(ids, null) },
    glidePitch: { enabled: ids.length >= 2, run: () => c.openDialog('glidePitch', ids) },
    vibratoEnvelope: { enabled: anyWave, run: () => c.openDialog('vibrato', ids) },
  }
}