// メニューバーと、右クリック（波形ブロック、MIDI ブロック、エンベロープ、何もない所）のメニューの並び
import { type MenuEntry, type MenuGroup } from 'pevenmui'
import { keyLabel, type Action } from '../keymap'
import { type Block, type EnvShape } from '../project'
import { ENVELOPES, type EnvKind } from '../envelopes'
import type { Command, CommandEnv } from './types'

/** メニューの並び。commands は buildCommands の表 */
export function buildMenus(env: CommandEnv, commands: Record<Action, Command>) {
  const { c, doc, t, selectedTrack, selectTrack, midiChosen, chosen, track, resetEnvelope, paste } = env
  /** メニューの項目（名前は menu.<操作の名前>） */
  const item = (a: Action, label = t(`menu.${a}` as Parameters<typeof t>[0])): MenuEntry => ({
    label,
    shortcut: keyLabel(a) || undefined,
    disabled: commands[a].enabled === false,
    onClick: commands[a].run,
  })
  const divider: MenuEntry = { divider: true }
  /** サブメニュー */
  const sub = (label: Parameters<typeof t>[0], submenu: MenuEntry[]): MenuEntry => ({ label: t(label), onClick: () => {}, submenu })
  // 和音の分離（試験的。設定で出したときだけ）
  const voiceItems = c.voiceSplit ? [item('splitVoicesByPitch'), item('splitVoicesByVolume')] : []
  // 最近使用したファイル（使えないブラウザでは出さない。WeVocalSynth と同じ）
  const r = c.recent
  const recent: MenuEntry[] = r.supported
    ? [{ label: t('menu.recent'), onClick: () => {}, submenu: r.names.length ? [...r.names.map((name, i): MenuEntry => ({ label: name, onClick: () => r.open(i) })), divider, { label: t('menu.recentClear'), onClick: r.clear }] : [{ label: t('menu.recentEmpty'), disabled: true, onClick: () => {} }] }]
    : []

  const menus: MenuGroup[] = [
    {
      label: t('menu.file'),
      accessKey: 'F',
      entries: [item('newWindow'), divider, item('newProject'), item('open'), ...recent, item('save'), item('saveAs'), item('saveOptimized'), divider, item('import'), item('export'), item('exportVideo'), item('exportWvsp'), ...(c.folder ? [item('saveRangeToFolder'), item('saveBlocksToFolder')] : []), divider, { label: t('menu.settings'), onClick: c.openSettings }],
    },
    {
      label: t('menu.edit'),
      accessKey: 'E',
      entries: [item('undo'), item('redo'), { label: t('menu.history'), onClick: c.openHistory }, divider, item('cut'), item('copy'), item('paste'), item('duplicate'), item('delete'), divider, item('selectAll'), item('clearRange'), divider, item('split'), item('splitRange'), item('splitSilence'), divider, sub('menu.rangeGroup', [item('trimRange'), item('deleteRange'), item('insertSilence'), item('repeatRange'), divider, item('copyRangeToTrack'), item('moveRangeToTrack')]), divider, { label: t('menu.marker'), onClick: () => {}, submenu: [item('addMarker'), item('prevMarker'), item('nextMarker'), item('clearMarkers')] }],
    },
    {
      label: t('menu.block'),
      accessKey: 'I',
      entries: [item('properties'), divider, sub('menu.pitchGroup', [item('pitchUp'), item('pitchDown'), item('pitchUpFine'), item('pitchDownFine'), item('pitchReset'), divider, item('glidePitch'), item('vibratoEnvelope')]), sub('menu.midiGroup', [item('addMidiBlock'), item('importMidi'), item('exportMidi'), divider, item('glueMidi'), item('editMidi'), item('trackInstrument')]), divider, item('normalize'), item('reverse'), item('bake')],
    },
    {
      label: t('menu.track'),
      accessKey: 'T',
      entries: [
        item('addTrack'),
        item('duplicateTrack'),
        item('renameTrack'),
        { label: t('track.addSubtrack'), disabled: !selectedTrack, onClick: () => selectedTrack && selectTrack(doc.addSubtrack(selectedTrack)) },
        {
          label: t('menu.removeTrack'),
          disabled: !selectedTrack,
          onClick: () => {
            if (selectedTrack) doc.removeTrack(selectedTrack)
            selectTrack(null)
            doc.select([])
          },
        },
        divider,
        { ...item('muteTrack'), checked: !!track?.mute },
        { ...item('soloTrack'), checked: !!track?.solo },
      ],
    },
    {
      label: t('menu.tools'),
      accessKey: 'L',
      // ボーカル抽出と分離、試験的機能のサブメニュー、音を作る道具、プラグインの道具（WeVocalSynth のツールメニューと同じ並び）
      entries: [sub('menu.extract', [item('splitVocals'), item('splitLead'), item('splitInstruments')]), ...(voiceItems.length ? [sub('menu.experimental', voiceItems)] : []), divider, item('sampler'), item('synth'), divider, item('kanaCut'), divider, item('pluginTool'), item('pluginAnalyze')],
    },
    {
      label: t('menu.transport'),
      accessKey: 'P',
      entries: [
        item('playStop', c.playing ? t('menu.stop') : t('menu.play')),
        item('pause'),
        item('playRange'),
        { ...item('record'), checked: c.recording },
        { ...item('repeat'), checked: c.repeat },
        divider,
        item('toStart'),
        item('toEnd'),
        divider,
        item('detectTempo'),
        item('addMarker'),
        item('prevMarker'),
        item('nextMarker'),
      ],
    },
    {
      label: t('menu.view'),
      accessKey: 'V',
      entries: [item('zoomIn'), item('zoomOut'), item('showAll'), item('zoomRange'), divider, { ...item('snap'), checked: c.snap }, { ...item('follow'), checked: c.follow }, { ...item('envelope'), checked: c.envelope }, { ...item('pitchEnvelope'), checked: c.pitchEnvelope }, { ...item('autoEdit'), checked: c.autoEdit }, { label: t('menu.beatGrid'), checked: c.beatGrid, onClick: c.toggleGrid }, { label: t('menu.analysis'), checked: c.showAnalysis, onClick: c.toggleAnalysis }, { label: t('menu.meters'), checked: c.showMeters, onClick: c.toggleMeters }, { label: t('menu.minimap'), checked: c.showMinimap, onClick: c.toggleMinimap }, { label: t('menu.statusBar'), checked: c.showStatusBar, onClick: c.toggleStatusBar }],
    },
    {
      label: t('menu.help'),
      accessKey: 'H',
      entries: [
        { label: t('menu.guide'), onClick: c.help.guide },
        { label: t('menu.shortcuts'), onClick: c.help.shortcuts },
        divider,
        { label: t('menu.checkUpdate'), onClick: c.help.checkUpdate },
        { label: t('menu.licenses'), onClick: c.help.licenses },
        { label: t('menu.about'), onClick: c.help.about },
      ],
    },
  ]

  /** 波形ブロックの右クリックのメニュー */
  const envelopeRangeMenu = (kind: EnvKind): MenuEntry => {
    const spec = ENVELOPES[kind]
    const field = kind === 'pitch' ? 'pitchEnvelopeRange' : 'envelopeRange'
    const defaultRange = kind === 'pitch' ? c.pitchEnvelopeRange : c.envelopeRange
    const valueLabel = kind === 'pitch' ? 'block.pitchEnvelopeRangeValue' : 'block.envelopeRangeValue'
    const defaultLabel = kind === 'pitch' ? 'block.pitchEnvelopeRangeDefault' : 'block.envelopeRangeDefault'
    return {
      label: t(kind === 'pitch' ? 'block.pitchEnvelopeRange' : 'block.envelopeRange'),
      onClick: () => {},
      submenu: [
        {
          label: t(defaultLabel, { n: defaultRange }),
          checked: chosen.length > 0 && chosen.every((b) => b[field] === undefined),
          onClick: () => doc.updateBlocks(Object.fromEntries(chosen.map((b) => [b.id, { [field]: undefined }]))),
        },
        ...spec.ranges.map((range): MenuEntry => ({
          label: t(valueLabel, { n: range }),
          checked: chosen.length > 0 && chosen.every((b) => b[field] === range),
          onClick: () => doc.updateBlocks(Object.fromEntries(chosen.map((b) => [b.id, { [field]: range }]))),
        })),
      ],
    }
  }

  const waveMenu: MenuEntry[] = [
    item('properties'),
    envelopeRangeMenu('volume'),
    envelopeRangeMenu('pitch'),
    divider,
    item('pitchUp'),
    item('pitchDown'),
    item('pitchReset'),
    item('vibratoEnvelope'),
    item('reverse'),
    item('bake'),
    divider,
    item('cut'),
    item('copy'),
    item('duplicate'),
    item('split'),
    item('delete'),
    divider,
    { label: t('menu.extract'), onClick: () => {}, submenu: [item('splitVocals'), item('splitLead'), item('splitInstruments'), ...voiceItems] },
    ...(c.folder ? [divider, item('saveBlocksToFolder')] : []),
  ]

  /** MIDI ブロックだけを選んでいるときの、ブロックのメニュー（右クリックと、指の長押し） */
  const midiMenu: MenuEntry[] = [
    item('properties'),
    item('editMidi'),
    item('trackInstrument'),
    divider,
    item('cut'),
    item('copy'),
    item('duplicate'),
    item('split'),
    item('delete', t('menu.deleteBlock')),
    divider,
    item('glueMidi'),
    item('exportMidi'),
  ]
  const blockMenu = chosen.length === 0 && midiChosen.length > 0 ? midiMenu : waveMenu

  /** 押した点が持つ、次の点までの形状の選択肢（今の形状にチェック） */
  const shapeEntries = (kind: EnvKind, b: Block, index: number): MenuEntry[] => {
    const spec = ENVELOPES[kind]
    const pts = spec.points(b)
    const cur = pts[index]?.shape ?? 'linear'
    const choices: [EnvShape, Parameters<typeof t>[0], number?][] = [
      ['linear', 'glide.shapeLinear'],
      ['square', 'glide.shapeSquare'],
      ['slowStartEnd', 'glide.shapeSlowStartEnd'],
      ['fastStart', 'glide.shapeFastStart'],
      ['fastEnd', 'glide.shapeFastEnd'],
      ['bezier', 'glide.shapeBezier', 0.6],
    ]
    return choices.map(([shape, label, tension]) => ({
      label: t(label),
      checked: cur === shape,
      disabled: index >= pts.length - 1,
      onClick: () => doc.updateBlock(b.id, spec.patch(b, pts.map((p, i) => (i === index ? { ...p, shape, tension } : p)))),
    }))
  }

  /** エンベロープの線か点の右クリックのメニュー。index は押した点の番号（点でなければ -1） */
  const envelopeMenu = (blockId: string, index: number): MenuEntry[] => {
    const kind = c.envKind
    const b = doc.project.blocks.find((x) => x.id === blockId)
    if (!kind || !b) return []
    const spec = ENVELOPES[kind]
    return [
      // 押した点から次の点までの形状（点が覚える。REAPER と同じ）
      ...(index >= 0 ? [{ label: t('menu.envelopeShape'), onClick: () => {}, submenu: shapeEntries(kind, b, index) }, divider] : []),
      ...(index >= 0 ? [{ label: t('menu.envelopeDeletePoint'), onClick: () => doc.updateBlock(b.id, spec.patch(b, spec.points(b).filter((_, i) => i !== index))) }, divider] : []),
      { label: t('menu.envelopeSelect'), checked: !c.envPen, onClick: () => c.setEnvPen(false) },
      { label: t('menu.envelopePen'), checked: c.envPen, onClick: () => c.setEnvPen(true) },
      divider,
      { label: t('menu.envelopeReset'), disabled: spec.points(b).length === 0, onClick: () => resetEnvelope(kind, chosen.some((x) => x.id === b.id) ? chosen.map((x) => x.id) : [b.id]) },
      ...(kind === 'pitch' ? [item('vibratoEnvelope'), item('glidePitch')] : []),
    ]
  }

  /** 押したトラックの操作（ミュート、ソロ、名前の変更、複製、削除）と、区切り。トラックがなければなし */
  const trackEntries = (id: string | null): MenuEntry[] => {
    const tr = id ? doc.project.tracks.find((x) => x.id === id) : undefined
    if (!tr) return []
    return [
      { label: t('menu.muteTrack'), checked: tr.mute, onClick: () => doc.updateTrack(tr.id, { mute: !tr.mute }) },
      { label: t('menu.soloTrack'), checked: tr.solo, onClick: () => doc.updateTrack(tr.id, { solo: !tr.solo }) },
      { label: t('menu.renameTrack'), onClick: () => c.openDialog('renameTrack', tr.id) },
      { label: t('menu.duplicateTrack'), onClick: () => doc.duplicateTrack(tr.id) },
      { label: t('menu.removeTrack'), onClick: () => doc.removeTrack(tr.id) },
      divider,
    ]
  }

  /** 何もない所の右クリックのメニュー。time と track は押した所 */
  const emptyMenu = (kind: 'lane' | 'ruler', time: number, track: string | null, marker?: string): MenuEntry[] =>
    kind === 'ruler'
      ? [
          // 押したマーカーの操作（名前の変更、ここからのテンポ、削除。WeVocalSynth と同じ）
          ...(marker
            ? [
                { label: t('marker.rename'), onClick: () => c.openDialog('marker', marker) },
                { label: t('marker.tempo'), onClick: () => c.openDialog('markerTempo', marker) },
                { label: t('marker.remove'), onClick: () => doc.removeMarker(marker) },
                divider,
              ]
            : []),
          { label: t('menu.addMarkerHere'), onClick: () => doc.addMarker(time) },
          { label: t('menu.setEndHere'), onClick: () => doc.setEnd(time) },
          { label: t('menu.autoEnd'), disabled: doc.project.end === undefined, onClick: () => doc.setEnd(null) },
          item('detectTempo'),
          divider,
          item('clearRange'),
        ]
      : [
          // 押したトラックの操作（トラックの欄を閉じているときも、ここからミュートやソロなどができる）
          ...trackEntries(track),
          { label: t('menu.pasteHere'), disabled: commands.paste.enabled === false, onClick: () => paste({ time, track }) },
          { label: t('menu.importHere'), onClick: () => c.importAt(time, track) },
          { label: t('menu.addMidiBlock'), onClick: () => doc.select([doc.addMidiAt(track ?? selectedTrack ?? doc.project.tracks[0]?.id, time)].filter((x): x is string => !!x)) },
          divider,
          item('selectAll'),
          item('splitRange'),
          item('clearRange'),
          divider,
          { label: t('menu.setEndHere'), onClick: () => doc.setEnd(time) },
          { label: t('menu.autoEnd'), disabled: doc.project.end === undefined, onClick: () => doc.setEnd(null) },
          divider,
          item('addTrack'),
        ]

  return { menus, blockMenu, emptyMenu, envelopeMenu }
}