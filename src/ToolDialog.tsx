// プラグインの道具と解析（選んだ波形ブロックの音に対して実行する）。道具は加工した音を新しい元の音にして置き換え（確定と同じ。元に戻せる）、解析は結果の一覧を出す
import { useEffect, useState } from 'react'
import { Box, Button, DialogActions, DialogContent, Typography } from '@mui/material'
import { WindowDialog, pevenFont } from 'pevenmui'
import { FxParams, LabeledSelect as Choice } from 'wevocal-lib/react'
import { availableTools, defaultValues, findTool, fxDescription, fxText, runTool, type ToolPlugin, type ToolRow } from 'wevocal-lib'
import { applyBaked, bakeBlocks, type Baked } from './bake'
import { i18n, useT } from './i18n'
import type { Project } from './project'

interface Result {
  block: string
  name: string
  rows: ToolRow[]
}

export default function ToolDialog(p: {
  open: boolean
  kind: 'tool' | 'analyzer'
  project: Project
  /** 選んでいる波形ブロックの id */
  ids: string[]
  /** 道具の結果を置いたプロジェクトにする */
  onApply: (next: Project) => void
  fail: (e: unknown) => void
  onClose: () => void
}) {
  const t = useT()
  const lang = i18n.useLang()
  const list = availableTools(p.kind)
  const [id, setId] = useState(list[0]?.manifest.id ?? '')
  const plugin: ToolPlugin | undefined = findTool(id) ?? list[0]
  const [values, setValues] = useState<Record<string, number>>({})
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<Result[]>([])
  // 道具を選び直したら、つまみは既定の値から
  useEffect(() => {
    if (plugin) setValues(defaultValues(plugin.manifest))
    setResults([])
  }, [plugin?.manifest.id])

  const run = async () => {
    if (!plugin || !p.ids.length) return
    setBusy(true)
    try {
      // 選んだ波形ブロックを、今の音（ピッチ、速度、音量、フェード、エンベロープを含めた音）にして渡す
      const baked = await bakeBlocks(p.project, p.ids, () => {}, 'all')
      const outs: Baked[] = []
      const rows: Result[] = []
      for (const b of baked) {
        const r = await runTool(plugin, { channels: b.source.clip.channels, sampleRate: b.source.clip.sampleRate }, values)
        if (p.kind === 'tool' && r.channels) {
          const clip = { sampleRate: b.source.clip.sampleRate, channels: r.channels }
          outs.push({ block: b.block, source: { ...b.source, clip, duration: clip.channels[0].length / clip.sampleRate } })
        } else rows.push({ block: b.block, name: b.source.name, rows: r.rows ?? [] })
      }
      if (outs.length) {
        p.onApply(applyBaked(p.project, outs, 'all'))
        p.onClose()
      } else setResults(rows)
    } catch (e) {
      p.fail(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <WindowDialog open={p.open} onClose={p.onClose} title={t(p.kind === 'tool' ? 'tool.title' : 'tool.analyzeTitle')} name={`tool-${p.kind}`} width={560} height={560} dialogProps={{ fullWidth: true, maxWidth: 'sm' }}>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Choice label={t('tool.plugin')} value={plugin?.manifest.id ?? ''} options={list.map((x): [string, string] => [x.manifest.id, fxText(x, 'name', lang)])} onChange={setId} />
          {plugin && <Typography sx={{ fontSize: pevenFont('sm'), color: 'text.secondary' }}>{fxDescription(plugin, lang)}</Typography>}
          {plugin && plugin.manifest.params.length > 0 && <FxParams plugin={{ manifest: plugin.manifest, lang: plugin.lang, create: () => null as never }} values={values} lang={lang} onChange={(k, v) => setValues((x) => ({ ...x, [k]: v }))} />}
          {!p.ids.length && <Typography sx={{ fontSize: pevenFont('base'), color: 'text.secondary' }}>{t('tool.noSelection')}</Typography>}
          {p.kind === 'tool' && p.ids.length > 0 && <Typography sx={{ fontSize: pevenFont('sm'), color: 'text.secondary' }}>{t('tool.help', { n: p.ids.length })}</Typography>}
          {results.map((r) => (
            <Box key={r.block}>
              <Typography sx={{ fontSize: pevenFont('base'), fontWeight: 500, mb: 0.5 }}>{r.name}</Typography>
              {r.rows.map((row) => (
                <Box key={row.key} sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
                  <Typography sx={{ fontSize: pevenFont('base'), color: 'text.secondary' }}>{plugin ? fxText(plugin, row.key, lang) : row.key}</Typography>
                  <Typography sx={{ fontSize: pevenFont('base') }} className="selectable">
                    {row.value}
                    {row.unit ? ` ${row.unit}` : ''}
                  </Typography>
                </Box>
              ))}
            </Box>
          ))}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button size="small" disabled={busy || !plugin || !p.ids.length} onClick={() => void run()}>
          {t(busy ? 'tool.running' : p.kind === 'tool' ? 'tool.run' : 'tool.analyze')}
        </Button>
        <Button size="small" onClick={p.onClose}>
          {t('common.close')}
        </Button>
      </DialogActions>
    </WindowDialog>
  )
}
