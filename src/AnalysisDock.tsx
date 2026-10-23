// 解析の欄を、画面の端の欄（ドック）に置くパネルにする。標準では下の欄に置き、「ダイアログにする」でダイアログにもできる。閉じると、設定の「解析の欄を表示」を切る
import type { ComponentProps } from 'react'
import { WindowDialog, useDock, useMobileLayout } from 'pevenmui'
import AnalysisPanel, { ANALYSIS_HEIGHT } from './AnalysisPanel'
import { useT } from './i18n'

/** タブの見出しの高さ（dockview） */
const TAB_HEIGHT = 30

export default function AnalysisDock({ onClose, ...panel }: ComponentProps<typeof AnalysisPanel> & { onClose: () => void }) {
  const t = useT()
  const dock = useDock()
  const mobile = useMobileLayout()
  // スマホには欄がないので、今までどおり時間軸の下に固定で出す
  if (mobile) return <AnalysisPanel {...panel} />
  // 時間軸と同じ幅で横にそろうのは、下の欄だけ（時間軸の下に、同じ左の余白で置くため）。ほかの端やダイアログでは、左の見出しの列を出さない
  const pref = dock?.edgeOf('analysis')
  const aligned = pref === null || pref === 'bottom'
  return (
    <WindowDialog open onClose={onClose} title={t('analysis.title')} closeLabel={t('common.close')} name="analysis" dockable defaultDock="bottom" dockSize={TAB_HEIGHT + ANALYSIS_HEIGHT + 33} width={960} height={320} dialogProps={{ fullWidth: true, maxWidth: 'lg' }}>
      <AnalysisPanel {...panel} headerWidth={aligned ? panel.headerWidth : 0} />
    </WindowDialog>
  )
}
