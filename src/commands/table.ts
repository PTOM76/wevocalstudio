// コマンドの表（操作の名前 → 実行と、押せるか）。キーの割り当て（keymap.ts）とメニューが、名前で呼ぶ
import { glueMidi } from '../midiLoop'
import { type Action } from '../keymap'
import { newId, midiBlocks } from '../project'
import { reverseBlocks } from '../reverse'
import { usedSources } from '../document/edits/blocks'
import { cropToRange, deleteRange, insertSilence, normalizeBlocks, rangeToNewTrack, repeatRange } from '../rangeEdit'
import type { MessageKey } from '../i18n'
import { defineCommands, type Command } from './types'

/** 操作の表。静的に 1 度だけ作り、今の選択と設定（CommandEnv）は、実行と判定のときに引数で渡す */
export const COMMANDS = defineCommands({
  playStop: { label: 'menu.playStop' as MessageKey, run: ({ c }) => (c.playing ? c.stop() : c.play()) },
  stop: { label: 'menu.stop' as MessageKey, run: ({ c }) => c.stop() },
  pause: { label: 'menu.pause' as MessageKey, run: ({ c }) => (c.playing ? c.pause() : c.play()) },
  repeat: { label: 'menu.repeat' as MessageKey, run: ({ c }) => c.toggleRepeat() },
  record: { label: 'menu.record' as MessageKey, run: ({ c }) => c.toggleRecord() },
  detectTempo: { label: 'menu.detectTempo' as MessageKey, enabled: ({ doc }) => doc.project.blocks.length > 0, run: ({ c }) => c.detectTempo() },
  toStart: { label: 'menu.toStart' as MessageKey, run: ({ c }) => c.seek(0) },
  cursorLeft: { label: 'menu.cursorLeft' as MessageKey, run: ({ c }) => c.seek(Math.max(0, c.cursor - c.gridStep())) },
  cursorRight: { label: 'menu.cursorRight' as MessageKey, run: ({ c }) => c.seek(c.cursor + c.gridStep()) },
  nudgeLeft: { label: 'menu.nudgeLeft' as MessageKey, enabled: ({ any }) => any, run: ({ nudge }) => nudge(-1) },
  nudgeRight: { label: 'menu.nudgeRight' as MessageKey, enabled: ({ any }) => any, run: ({ nudge }) => nudge(1) },
  newProject: { label: 'menu.newProject' as MessageKey, run: ({ c }) => c.newProject() },
  addTrack: { label: 'menu.addTrack' as MessageKey, run: ({ selectTrack, doc, selectedTrack }) => selectTrack(doc.addTrack(selectedTrack)) },
  toEnd: { label: 'menu.toEnd' as MessageKey, run: ({ c, doc }) => c.seek(doc.project.blocks.reduce((m, b) => Math.max(m, b.start + b.length), 0)) },
  snap: { label: 'menu.snap' as MessageKey, run: ({ c }) => c.toggleSnap() },
  follow: { label: 'menu.follow' as MessageKey, run: ({ c }) => c.toggleFollow() },
  envelope: { label: 'menu.envelope' as MessageKey, run: ({ c }) => c.toggleEnvelope() },
  pitchEnvelope: { label: 'menu.pitchEnvelope' as MessageKey, run: ({ c }) => c.togglePitchEnvelope() },
  envelopeReset: { label: 'menu.envelopeReset' as MessageKey, enabled: ({ c, envBlocks }) => !!c.envKind && envBlocks.length > 0, run: ({ c, resetEnvelope, envBlocks }) => c.envKind && resetEnvelope(c.envKind, envBlocks.map((b) => b.id)) },
  envelopeTool: { label: 'menu.envelopeTool' as MessageKey, enabled: ({ c }) => !!c.envKind, run: ({ c }) => c.setEnvPen(!c.envPen) },
  autoEdit: { label: 'menu.autoEdit' as MessageKey, run: ({ c }) => c.toggleAutoEdit() },
  zoomIn: { label: 'menu.zoomIn' as MessageKey, run: ({ c }) => c.zoom(1.5) },
  zoomOut: { label: 'menu.zoomOut' as MessageKey, run: ({ c }) => c.zoom(1 / 1.5) },
  properties: { label: 'menu.properties' as MessageKey, enabled: ({ any }) => any, run: ({ anyWave, c, chosen, midiSel }) => (anyWave ? c.openProperties(chosen[0].id) : midiSel && c.openDialog('midiProps', midiSel.id)) },
  addMarker: { label: 'menu.addMarker' as MessageKey, run: ({ doc, c }) => doc.addMarker(c.cursor) },
  nextMarker: { label: 'menu.nextMarker' as MessageKey, run: ({ doc, c }) => { const m = doc.project.markers.find((m) => m.time > c.cursor + 1e-3); if (m) c.seek(m.time) } },
  prevMarker: { label: 'menu.prevMarker' as MessageKey, run: ({ doc, c }) => { const m = doc.project.markers.findLast((m) => m.time < c.cursor - 1e-3); if (m) c.seek(m.time) } },
  split: { label: 'menu.split' as MessageKey, enabled: ({ canSplit }) => canSplit, run: ({ doc, c, ids, midiChosen }) => doc.split(c.cursor, [...ids, ...midiChosen.map((b) => b.id)]) },
  splitSilence: { label: 'menu.splitSilence' as MessageKey, enabled: ({ anyWave }) => anyWave, run: ({ doc, ids }) => doc.splitBySilence(ids) },
  selectAll: { label: 'menu.selectAll' as MessageKey, run: ({ doc }) => doc.select(doc.project.blocks.map((b) => b.id)) },
  // 範囲の両端で、かかっている波形ブロックを全部分ける
  splitRange: {
    label: 'menu.splitRange' as MessageKey,
    enabled: ({ doc }) => !!doc.range,
    run: ({ doc }) => {
      if (!doc.range) return
      doc.split(doc.range.start)
      doc.split(doc.range.end)
    },
  },
  // 選択の解除（範囲と波形ブロック）
  clearRange: { label: 'menu.clearRange' as MessageKey, enabled: ({ doc, any }) => !!doc.range || any, run: ({ doc }) => doc.apply((p) => p, undefined, { range: null, selected: [] }) },
  trimRange: { label: 'menu.trimRange' as MessageKey, enabled: ({ doc }) => !!doc.range, run: ({ doc, c }) => doc.range && doc.apply((p) => cropToRange(p, doc.range!, c.defaultFade)) },
  deleteRange: { label: 'menu.deleteRange' as MessageKey, enabled: ({ doc }) => !!doc.range, run: ({ doc, c }) => doc.range && doc.apply((p) => deleteRange(p, doc.range!, c.defaultFade), undefined, { range: null }) },
  insertSilence: { label: 'menu.insertSilence' as MessageKey, enabled: ({ doc }) => !!doc.range, run: ({ doc, c }) => doc.range && (doc.apply((p) => insertSilence(p, doc.range!.start, doc.range!.end - doc.range!.start, c.defaultFade)), c.seekAfterInsert && c.moveCursor(doc.range.end)) },
  repeatRange: { label: 'menu.repeatRange' as MessageKey, enabled: ({ doc }) => !!doc.range, run: ({ doc, c }) => doc.range && doc.apply((p) => repeatRange(p, doc.range!, 1, newId, c.defaultFade)) },
  normalize: { label: 'menu.normalize' as MessageKey, enabled: ({ anyWave }) => anyWave, run: ({ doc, ids }) => doc.apply((p) => normalizeBlocks(p, ids)) },
  copyRangeToTrack: { label: 'menu.copyRangeToTrack' as MessageKey, enabled: ({ doc }) => !!doc.range, run: ({ doc, selectedTrack, c }) => doc.range && doc.apply((p) => rangeToNewTrack(p, doc.range!, false, selectedTrack, c.defaultFade)) },
  moveRangeToTrack: { label: 'menu.moveRangeToTrack' as MessageKey, enabled: ({ doc }) => !!doc.range, run: ({ doc, selectedTrack, c }) => doc.range && doc.apply((p) => rangeToNewTrack(p, doc.range!, true, selectedTrack, c.defaultFade)) },
  reverse: { label: 'menu.reverse' as MessageKey, enabled: ({ anyWave }) => anyWave, run: ({ doc, ids }) => doc.apply((p) => reverseBlocks(p, ids)) },
  bake: { label: 'menu.bake' as MessageKey, enabled: ({ anyWave }) => anyWave, run: ({ c, ids }) => c.bake(ids) },
  // 分けるのは 1 つずつ（選んでいる最後のもの）
  synth: { label: 'menu.synth' as MessageKey, run: ({ c }) => c.openDialog('synth') },
  sampler: { label: 'menu.sampler' as MessageKey, enabled: ({ anyWave }) => anyWave, run: ({ any, c, ids }) => any && c.openDialog('sampler', ids[ids.length - 1]) },
  kanaCut: { label: 'menu.kanaCut' as MessageKey, enabled: ({ anyWave }) => anyWave, run: ({ any, c, ids }) => any && c.openDialog('kanaCut', ids[ids.length - 1]) },
  addMidiBlock: {
    label: 'menu.addMidiBlock' as MessageKey,
    run: ({ doc, selectedTrack, c }) => {
      const id = doc.addMidiAt(selectedTrack ?? doc.project.tracks[0]?.id, c.cursor)
      if (id) doc.select([id])
    },
  },
  importMidi: { label: 'menu.importMidi' as MessageKey, run: ({ c }) => c.importMidi() },
  glueMidi: { label: 'menu.glueMidi' as MessageKey, enabled: ({ midiChosen }) => midiChosen.length > 1, run: ({ doc, midiChosen }) => doc.apply((q) => glueMidi(q, midiChosen.map((b) => b.id))) },
  exportMidi: { label: 'menu.exportMidi' as MessageKey, enabled: ({ doc }) => midiBlocks(doc.project).length > 0, run: ({ c, midiChosen }) => c.exportMidi(midiChosen.map((b) => b.id)) },
  pluginTool: { label: 'menu.pluginTool' as MessageKey, run: ({ c }) => c.openDialog('tool') },
  pluginAnalyze: { label: 'menu.pluginAnalyze' as MessageKey, run: ({ c }) => c.openDialog('analyze') },
  editMidi: { label: 'menu.editMidi' as MessageKey, enabled: ({ midiSel }) => !!midiSel, run: ({ midiSel, c }) => midiSel && c.openDialog('pianoRoll', midiSel.id) },
  // 選んでいるトラック。なければ選んでいるブロックのトラック（ブロックを Ctrl や複数選択すると、トラックの選択が外れるため）
  trackInstrument: { label: 'menu.trackInstrument' as MessageKey, enabled: ({ track, blockTrack }) => !!(track ?? blockTrack), run: ({ track, blockTrack, c }) => (track ?? blockTrack) && c.openDialog('instrument', (track ?? blockTrack)!.id) },
  splitVocals: { label: 'menu.splitVocals' as MessageKey, enabled: ({ anyWave }) => anyWave, run: ({ any, c, ids }) => any && c.extract.vocals(ids[ids.length - 1]) },
  splitLead: { label: 'menu.splitLead' as MessageKey, enabled: ({ anyWave }) => anyWave, run: ({ any, c, ids }) => any && c.extract.lead(ids[ids.length - 1]) },
  splitInstruments: { label: 'menu.splitInstruments' as MessageKey, enabled: ({ anyWave }) => anyWave, run: ({ any, c, ids }) => any && c.extract.instruments(ids[ids.length - 1]) },
  splitVoicesByPitch: { label: 'menu.splitVoicesByPitch' as MessageKey, enabled: ({ anyWave }) => anyWave, run: ({ any, c, ids }) => any && c.extract.voices(ids[ids.length - 1], 'pitch') },
  splitVoicesByVolume: { label: 'menu.splitVoicesByVolume' as MessageKey, enabled: ({ anyWave }) => anyWave, run: ({ any, c, ids }) => any && c.extract.voices(ids[ids.length - 1], 'volume') },
  showAll: { label: 'menu.showAll' as MessageKey, enabled: ({ c }) => c.end > 0, run: ({ c }) => c.fit(0, c.end) },
  zoomRange: { label: 'menu.zoomRange' as MessageKey, enabled: ({ doc, anyWave }) => !!doc.range || anyWave, run: ({ doc, c, chosen }) => (doc.range ? c.fit(doc.range.start, doc.range.end) : c.fit(Math.min(...chosen.map((b) => b.start)), Math.max(...chosen.map((b) => b.start + b.length)))) },
  playRange: { label: 'menu.playRange' as MessageKey, enabled: ({ doc }) => !!doc.range, run: ({ doc, c }) => doc.range && c.playAt(doc.range.start) },
  renameTrack: { label: 'menu.renameTrack' as MessageKey, enabled: ({ selectedTrack }) => !!selectedTrack, run: ({ selectedTrack, c }) => selectedTrack && c.openDialog('renameTrack', selectedTrack) },
  duplicateTrack: { label: 'menu.duplicateTrack' as MessageKey, enabled: ({ selectedTrack }) => !!selectedTrack, run: ({ selectedTrack, doc }) => selectedTrack && doc.duplicateTrack(selectedTrack) },
  muteTrack: { label: 'menu.muteTrack' as MessageKey, enabled: ({ track }) => !!track, run: ({ track, doc }) => track && doc.updateTracks(Object.fromEntries((doc.selectedTracks.includes(track.id) ? doc.selectedTracks : [track.id]).map((id) => [id, { mute: !track.mute }]))) },
  soloTrack: { label: 'menu.soloTrack' as MessageKey, enabled: ({ track }) => !!track, run: ({ track, doc }) => track && doc.updateTracks(Object.fromEntries((doc.selectedTracks.includes(track.id) ? doc.selectedTracks : [track.id]).map((id) => [id, { solo: !track.solo }]))) },
  clearMarkers: { label: 'menu.clearMarkers' as MessageKey, enabled: ({ doc }) => doc.project.markers.length > 0, run: ({ doc }) => doc.apply((p) => ({ ...p, markers: [] })) },
  // 波形ブロックか MIDI ブロックを選んでいればそれを、選んでいなければ選んでいるトラックを（元に戻せる）
  delete: {
    label: 'menu.delete' as MessageKey,
    enabled: ({ any, selectedTrack }) => any || !!selectedTrack,
    run: ({ any, doc, ids, midiChosen, selectedTrack, selectTrack }) => {
      if (any) {
        doc.removeBlocks([...ids, ...midiChosen.map((b) => b.id)])
        doc.select([])
      } else if (selectedTrack) {
        doc.removeTrack(selectedTrack)
        selectTrack(null)
      }
    },
  },
  undo: { label: 'menu.undo' as MessageKey, enabled: ({ doc }) => doc.canUndo, run: ({ doc }) => doc.undo() },
  redo: { label: 'menu.redo' as MessageKey, enabled: ({ doc }) => doc.canRedo, run: ({ doc }) => doc.redo() },
  // 切り取り（コピーしてから消す）
  cut: {
    label: 'menu.cut' as MessageKey,
    enabled: ({ any }) => any,
    run: ({ clipboard, chosen, midiClipboard, midiChosen, trackClipboard, clipSources, copied: setCopied, doc, ids }) => {
      clipboard.current = chosen
      clipSources.current = usedSources(doc.project, chosen, [])
      midiClipboard.current = midiChosen
      trackClipboard.current = null
      setCopied()
      doc.removeBlocks([...ids, ...midiChosen.map((b) => b.id)])
      doc.select([])
    },
  },
  copy: {
    label: 'menu.copy' as MessageKey,
    enabled: ({ any, selectedTrack }) => any || !!selectedTrack,
    run: ({ any, doc, selectedTrack, trackClipboard, clipboard, chosen, midiClipboard, midiChosen, clipSources, copied: setCopied }) => {
      // 波形ブロックを選んでいればそれ、なければ選んでいるトラックを波形ブロックごと
      const track = !any ? doc.project.tracks.find((t) => t.id === selectedTrack) : undefined
      trackClipboard.current = track ? { track, blocks: doc.project.blocks.filter((b) => b.track === track.id) } : null
      clipboard.current = track ? [] : chosen
      midiClipboard.current = track ? [] : midiChosen
      clipSources.current = trackClipboard.current ? usedSources(doc.project, trackClipboard.current.blocks, [track!]) : usedSources(doc.project, chosen, [])
      setCopied()
    },
  },
  paste: { label: 'menu.paste' as MessageKey, enabled: ({ clipboard, midiClipboard, trackClipboard }) => clipboard.current.length > 0 || midiClipboard.current.length > 0 || !!trackClipboard.current, run: ({ paste }) => paste() },
  duplicate: { label: 'menu.duplicate' as MessageKey, enabled: ({ any }) => any, run: ({ duplicate }) => duplicate() },
  open: { label: 'menu.open' as MessageKey, run: ({ c }) => c.openFile() },
  // 上限に達していれば知らせる（設定の「同時に開くウィンドウの数」。WeVocalSynth と同じ）
  newWindow: { label: 'menu.newWindow' as MessageKey, run: ({ c }) => c.newWindow() },
  save: { label: 'menu.save' as MessageKey, run: ({ c }) => c.save() },
  saveAs: { label: 'menu.saveAs' as MessageKey, run: ({ c }) => c.saveAs() },
  saveRangeToFolder: { label: 'menu.saveRangeToFolder' as MessageKey, enabled: ({ c, doc }) => !!c.folder && !!doc.range, run: ({ c }) => c.folder?.saveRange() },
  saveBlocksToFolder: { label: 'menu.saveBlocksToFolder' as MessageKey, enabled: ({ c, any }) => !!c.folder && any, run: ({ c, ids }) => c.folder?.saveBlocks(ids) },
  import: { label: 'menu.import' as MessageKey, run: ({ c }) => c.importFiles() },
  saveOptimized: { label: 'menu.saveOptimized' as MessageKey, enabled: ({ doc }) => doc.project.blocks.length > 0, run: ({ c }) => c.saveOptimized() },
  export: { label: 'menu.export' as MessageKey, enabled: ({ doc }) => doc.project.blocks.length > 0, run: ({ c }) => c.openExport() },
  exportVideo: { label: 'menu.exportVideo' as MessageKey, enabled: ({ doc }) => doc.project.blocks.length > 0, run: ({ c }) => c.exportVideo() },
  exportWvsp: { label: 'menu.exportWvsp' as MessageKey, enabled: ({ doc }) => doc.project.blocks.length > 0, run: ({ c }) => c.exportWvsp() },
  pitchUp: { label: 'menu.pitchUp' as MessageKey, enabled: ({ anyWave }) => anyWave, run: ({ doc, ids }) => doc.nudgePitch(ids, 1) },
  pitchDown: { label: 'menu.pitchDown' as MessageKey, enabled: ({ anyWave }) => anyWave, run: ({ doc, ids }) => doc.nudgePitch(ids, -1) },
  pitchUpFine: { label: 'menu.pitchUpFine' as MessageKey, enabled: ({ anyWave }) => anyWave, run: ({ doc, ids }) => doc.nudgePitch(ids, 0.1) },
  pitchDownFine: { label: 'menu.pitchDownFine' as MessageKey, enabled: ({ anyWave }) => anyWave, run: ({ doc, ids }) => doc.nudgePitch(ids, -0.1) },
  pitchReset: { label: 'menu.pitchReset' as MessageKey, enabled: ({ anyWave }) => anyWave, run: ({ doc, ids }) => doc.nudgePitch(ids, null) },
  glidePitch: { label: 'menu.glidePitch' as MessageKey, enabled: ({ ids }) => ids.length >= 2, run: ({ c, ids }) => c.openDialog('glidePitch', ids) },
  vibratoEnvelope: { label: 'menu.vibratoEnvelope' as MessageKey, enabled: ({ anyWave }) => anyWave, run: ({ c, ids }) => c.openDialog('vibrato', ids) },
}) satisfies Record<Action, Command>
