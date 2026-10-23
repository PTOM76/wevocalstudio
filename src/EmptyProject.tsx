// 何も置いていないときの案内（開く、音を作る、録音、最近使用したファイル。部品は PevenMUI の EmptyState。WeVocalSynth と同じ）。時間軸の操作は妨げない
import { Box } from '@mui/material'
import { faFolderOpen, faMicrophone, faWaveSquare } from '@fortawesome/free-solid-svg-icons'
import { EmptyState } from 'pevenmui'
import { canRecord } from 'wevocal-lib'
import { useT } from './i18n'
import type { useProjectFile } from './useProjectFile'

export default function EmptyProject(p: { headerWidth: number; onChoose: () => void; onSynth: () => void; onRecord: () => void; recent: ReturnType<typeof useProjectFile>['recent'] }) {
  const t = useT()
  return (
    <Box sx={{ position: 'absolute', inset: 0, boxSizing: 'border-box', pl: `${p.headerWidth + 16}px`, pr: 2, pointerEvents: 'none', '& button': { pointerEvents: 'auto' } }}>
      <EmptyState
        message={t('empty.formats')}
        primary={{ label: t('empty.choose'), icon: faFolderOpen, onClick: p.onChoose }}
        actions={[{ label: t('synth.open'), icon: faWaveSquare, onClick: p.onSynth }, ...(canRecord() ? [{ label: t('record.title'), icon: faMicrophone, onClick: p.onRecord }] : [])]}
        recent={p.recent.supported ? { title: t('menu.recent'), names: p.recent.names, open: p.recent.open, more: (n) => t('empty.showMore', { n }), less: t('empty.showLess') } : undefined}
      />
    </Box>
  )
}
