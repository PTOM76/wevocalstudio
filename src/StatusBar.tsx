// PC の下のステータスバー（WeVocalSynth と同じ並び）。プロジェクト名、書き出しの形式、範囲選択、BPM、処理中のゲージ
import type { ReactNode } from 'react'
import { JobGauge, NameField, SelectionField, StatusBar as Bar, StatusItem, StatusSpacer } from 'pevenmui'
import type { Range } from 'wevocal-lib'
import { useT } from './i18n'
import { countRender } from 'pevenmui/debug'

export default function StatusBar(p: {
  fileName: string
  dirty: boolean
  onRename: (name: string) => void
  sampleRate: number
  tracks: number
  range: Range | null
  onRange: (r: Range | null) => void
  bpm: number
  /** 長さ（範囲の入力の上限） */
  duration: number
  /** 範囲を決めたフォルダーへ保存する（使えないブラウザでは渡さない） */
  onQuickSave?: () => void
  /** BPM の表示と入力（PevenMUI の TempoField。WeVocalSynth と同じ） */
  tempo: ReactNode
}) {
  countRender('StatusBar')
  const t = useT()
  return (
    <Bar>
      {/* プロジェクト名。押すと名前を変えられる（保存と書き出しのファイル名になる。PevenMUI の NameField） */}
      <NameField name={p.fileName} title={t('status.projectName')} hint={t('status.renameHint')} onRename={p.onRename}>
        {p.fileName || '—'}
        {p.dirty && ' *'}
      </NameField>
      <StatusItem secondary>
        {p.sampleRate} Hz・Stereo・{t('status.tracks', { n: p.tracks })}
      </StatusItem>
      {/* 範囲選択の表示と入力（PevenMUI の SelectionField。WeVocalSynth と同じ） */}
      <SelectionField
        duration={p.duration}
        selection={p.range}
        selectionCount={p.range ? 1 : 0}
        bpm={p.bpm}
        onSelectionChange={p.onRange}
        onQuickSave={p.onQuickSave}
        labels={{ selection: t('common.selection'), beats: (n) => t('selection.beats', { n }), start: t('clip.start'), end: t('clip.end'), saveOrDrag: t('selection.saveOrDrag'), folderSave: t('folder.save'), dragOut: t('selection.dragOut') }}
      />
      {p.tempo}
      <StatusSpacer />
      {/* 処理中の進み具合（ピッチなどを作る、書き出し。PevenMUI の JobGauge。WeVocalSynth と同じ） */}
      <JobGauge<string> kindLabel={(k) => t(`job.${k}` as Parameters<typeof t>[0])} />
    </Bar>
  )
}
