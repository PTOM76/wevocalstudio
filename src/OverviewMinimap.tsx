// 全体を縮めた波形（ミニマップ）。高さはミニマップの分だけで、伸ばさない。WeVocalSynth と同じ wevocal-lib の部品
import { Box } from '@mui/material'
import { usePalette } from 'pevenmui'
import { SELECTION_DARK, SELECTION_LIGHT, type Range } from 'wevocal-lib'
import { Minimap } from 'wevocal-lib/react'
import type { TimelineView } from './drawTimeline'
import { useT } from './i18n'
import type { buildOverview } from './overview'

export default function OverviewMinimap(p: { overview: ReturnType<typeof buildOverview>; view: TimelineView; width: number; range: Range | null; scrollTo: (start: number) => void; position: number; livePosition: () => number; playing: boolean; showPlayhead: boolean }) {
  const t = useT()
  const { pal, dark } = usePalette()
  return (
    <Box sx={{ flexShrink: 0, flexGrow: 0, borderTop: 1, borderColor: 'divider' }}>
      <Minimap
        clip={p.overview.clip}
        duration={p.overview.duration}
        colors={{ text: pal.text.primary, textSecondary: pal.text.secondary, divider: pal.divider, wave: pal.primary.main, selection: dark ? SELECTION_DARK : SELECTION_LIGHT }}
        view={{ start: p.view.scroll, dur: p.width / p.view.pps }}
        selections={p.range ? [p.range] : []}
        scrollTo={p.scrollTo}
        label={t('menu.minimap')}
        position={p.position}
        livePosition={p.livePosition}
        playing={p.playing}
        showPlayhead={p.showPlayhead}
      />
    </Box>
  )
}
