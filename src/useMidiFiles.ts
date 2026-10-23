// MIDI ファイルの書き出しと読み込み（ブロックのメニューから）。読み込みは選んだファイルをダイアログに渡し、トラックと MIDI ブロックにするのはそちらで行う
import { downloadBlob } from 'wevocal-lib'
import type { useT } from './i18n'
import { buildMidi } from './midiExport'
import { readMidi, type MidiPending } from './midiImport'
import type { Project } from './project'

export function useMidiFiles(o: { project: Project; fileName: string; t: ReturnType<typeof useT>; notify: (message: string) => void; fail: (e: unknown) => void; onPending: (m: MidiPending) => void }) {
  const { project, fileName, t, notify, fail, onPending } = o
  return {
    /** MIDI ブロックを MIDI ファイルに書き出す（選んだもの。なければ全部） */
    exportMidi: (ids: string[]) => {
      const data = buildMidi(project, ids)
      if (!data) return notify(t('midi.exportEmpty'))
      downloadBlob(new Blob([data as BlobPart], { type: 'audio/midi' }), `${fileName.replace(/\.[^.]+$/, '')}.mid`)
    },
    /** MIDI ファイルを選んで読む */
    importMidi: () => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.mid,.midi,audio/midi'
      input.onchange = () => {
        const file = input.files?.[0]
        if (file) void readMidi(file).then((m) => (m ? onPending(m) : notify(t('midi.empty')))).catch(fail)
      }
      input.click()
    },
  }
}
