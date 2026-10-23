// 表示と道具の ON / OFF（設定の値）を、コマンドの文脈（ActionContext）の形にする。切り替えは設定を変えるだけ
import type { ActionContext } from './commands/types'
import type { Settings } from './settings/settings'

type Toggles = Pick<ActionContext, 'snap' | 'toggleSnap' | 'follow' | 'envelope' | 'toggleEnvelope' | 'pitchEnvelope' | 'pitchEnvelopeRange' | 'envelopeRange' | 'togglePitchEnvelope' | 'autoEdit' | 'toggleAutoEdit' | 'toggleFollow' | 'beatGrid' | 'toggleGrid' | 'showAnalysis' | 'toggleAnalysis' | 'showMeters' | 'toggleMeters' | 'showMinimap' | 'toggleMinimap' | 'showStatusBar' | 'toggleStatusBar'>

export function viewToggles(settings: Settings, onSettingsChange: (patch: Partial<Settings>) => void): Toggles {
  return {
    snap: settings.snap,
    toggleSnap: () => onSettingsChange({ snap: !settings.snap }),
    follow: settings.followPlayhead,
    envelope: settings.envelope,
    // 音量とピッチのエンベロープは、どちらか一方だけを出す
    toggleEnvelope: () => onSettingsChange({ envelope: !settings.envelope, pitchEnvelope: false, autoEdit: false }),
    pitchEnvelope: settings.pitchEnvelope,
    pitchEnvelopeRange: settings.pitchEnvelopeRange,
    envelopeRange: settings.envelopeRange,
    togglePitchEnvelope: () => onSettingsChange({ pitchEnvelope: !settings.pitchEnvelope, envelope: false, autoEdit: false }),
    autoEdit: settings.autoEdit,
    toggleAutoEdit: () => onSettingsChange({ autoEdit: !settings.autoEdit, envelope: false, pitchEnvelope: false }),
    toggleFollow: () => onSettingsChange({ followPlayhead: !settings.followPlayhead }),
    beatGrid: settings.grid === 'beats',
    toggleGrid: () => onSettingsChange({ grid: settings.grid === 'beats' ? 'time' : 'beats' }),
    showAnalysis: settings.showAnalysis,
    toggleAnalysis: () => onSettingsChange({ showAnalysis: !settings.showAnalysis }),
    showMeters: settings.showMeters,
    toggleMeters: () => onSettingsChange({ showMeters: !settings.showMeters }),
    showMinimap: settings.showMinimap,
    toggleMinimap: () => onSettingsChange({ showMinimap: !settings.showMinimap }),
    showStatusBar: settings.showStatusBar,
    toggleStatusBar: () => onSettingsChange({ showStatusBar: !settings.showStatusBar }),
  }
}
