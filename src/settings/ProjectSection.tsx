// プロジェクト設定の名前とテンポを編集する
import { useEffect, useState } from 'react'
import { TextField } from '@mui/material'
import { Group, NumberInput, Row } from 'pevenmui'
import { useT } from '../i18n'
import type { Tempo } from '../project'

/** プロジェクト設定に渡す値と変更操作 */
export interface ProjectSettings {
  name: string
  tempo: Tempo
  onRename: (name: string) => void
  onTempoChange: (patch: Partial<Tempo>) => void
}

export default function ProjectSection({ project }: { project: ProjectSettings }) {
  const t = useT()
  const [name, setName] = useState(project.name)
  useEffect(() => setName(project.name), [project.name])
  const commitName = () => {
    if (name.trim() && name.trim() !== project.name) project.onRename(name.trim())
    else setName(project.name)
  }
  const { tempo, onTempoChange } = project
  return (
    <>
      <Group title={t('settings.groupProject')}>
        <Row label={t('project.name')}>
          <TextField
            size="small"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && commitName()}
            slotProps={{ htmlInput: { 'aria-label': t('project.name'), style: { fontSize: 13 } } }}
            sx={{ width: 240, maxWidth: '100%' }}
          />
        </Row>
      </Group>
      <Group title={t('settings.groupTempo')}>
        <Row label={t('settings.bpm')}>
          <NumberInput value={tempo.bpm} onChange={(bpm) => onTempoChange({ bpm })} min={20} max={400} step={0.01} unit="BPM" width={110} ariaLabel={t('settings.bpm')} />
        </Row>
        <Row label={t('settings.beatsPerBar')}>
          <NumberInput value={tempo.beatsPerBar} onChange={(beatsPerBar) => onTempoChange({ beatsPerBar: Math.round(beatsPerBar) })} min={1} max={16} step={1} width={110} ariaLabel={t('settings.beatsPerBar')} />
        </Row>
        <Row label={t('settings.beatOffset')}>
          <NumberInput value={tempo.beatOffset} onChange={(beatOffset) => onTempoChange({ beatOffset })} min={0} max={60} step={0.001} unit={t('vibrato.secondUnit')} width={110} ariaLabel={t('settings.beatOffset')} />
        </Row>
      </Group>
    </>
  )
}
