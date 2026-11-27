// ほかの DAW（REAPER、DAWproject）への書き出しのダイアログ。波形ブロックの渡し方を選ぶ（選んだものは設定の exchangeBlocks に覚える）。実行は useProjectFile
import { useEffect, useState } from 'react'
import { Box, Button, DialogActions, DialogContent, FormControlLabel, Radio, RadioGroup, Stack, Typography } from '@mui/material'
import { WindowDialog, enterToSubmit } from 'pevenmui'
import type { ExchangeBlocks } from './exchange/exchange'
import { useT, type MessageKey } from './i18n'

export type DawFormat = 'rpp' | 'dawproject'

export default function DawExportDialog(p: { open: boolean; format: DawFormat; blocks: ExchangeBlocks; onClose: () => void; onRun: (format: DawFormat, blocks: ExchangeBlocks) => void }) {
  const t = useT()
  const [blocks, setBlocks] = useState(p.blocks)
  // 開くたびに、覚えている渡し方から始める
  useEffect(() => {
    if (p.open) setBlocks(p.blocks)
  }, [p.open, p.blocks])
  const run = () => {
    p.onRun(p.format, blocks)
    p.onClose()
  }
  const option = (value: ExchangeBlocks, label: MessageKey, help: MessageKey) => (
    <Box>
      <FormControlLabel value={value} control={<Radio size="small" />} label={t(label)} />
      <Typography variant="caption" component="div" sx={{ color: 'text.secondary', pl: 3.5, mt: -0.5 }}>
        {t(help)}
      </Typography>
    </Box>
  )
  return (
    <WindowDialog open={p.open} onClose={p.onClose} title={t(p.format === 'rpp' ? 'dawExport.titleRpp' : 'dawExport.titleDawproject')} name="dawExport" width={500} height={460} onKeyDown={enterToSubmit(run)} dialogProps={{ maxWidth: 'sm', fullWidth: true }}>
      <DialogContent>
        <Stack spacing={1}>
          <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>
            {t('settings.exchangeBlocks')}
          </Typography>
          <RadioGroup value={blocks} onChange={(e) => setBlocks(e.target.value as ExchangeBlocks)}>
            {option('original', 'settings.exchangeOriginal', p.format === 'rpp' ? 'dawExport.originalHelpRpp' : 'dawExport.originalHelpDawproject')}
            {option('changed', 'settings.exchangeChanged', 'dawExport.changedHelp')}
            {option('all', 'settings.exchangeAll', 'dawExport.allHelp')}
          </RadioGroup>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Box sx={{ flex: 1 }} />
        <Button onClick={p.onClose}>{t('common.cancel')}</Button>
        <Button onClick={run}>{t('dawExport.run')}</Button>
      </DialogActions>
    </WindowDialog>
  )
}
