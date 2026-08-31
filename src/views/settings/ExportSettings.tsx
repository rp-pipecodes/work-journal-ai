import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useOnScreenToast } from '@/components/on-screen-toast'
import {
  describeExport,
  exportFileName,
  type Journal,
} from '@/journal/journal'
import type { Desktop } from '@/platform/desktop'
import { SettingsGroup, SettingsRow } from './SettingsGroup'

/** The one Settings action: export the whole journal to Markdown. */
export default function ExportSettings({
  desktop,
  journal,
}: {
  desktop: Desktop
  journal: Promise<Journal>
}) {
  const [exported, setExported] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  // Every message this group says, and only while it is the section showing:
  // an export finishes long after it was asked for, and the line under the
  // button keeps the answer for a reader who has gone elsewhere.
  const says = useOnScreenToast()

  /**
   * The whole journal, on disk and outside this app. The result is said twice
   * on purpose: a toast, which is where the user is looking, and the line
   * under the button, which is still there once the toast has gone.
   */
  function exportJournal() {
    setExporting(true)
    setExported(null)
    void (async () => {
      try {
        const exportedJournal = await (await journal).exportJournal()
        const file = await desktop.exportJournal(
          exportedJournal.markdown,
          exportFileName(new Date()),
        )
        const said = describeExport(exportedJournal, file.path)
        setExported(said)
        says.success(said)
      } catch (error) {
        console.error('could not export the journal', error)
        const said = 'Could not export the journal.'
        setExported(said)
        says.failure(said)
      } finally {
        setExporting(false)
      }
    })()
  }

  return (
    <SettingsGroup>
      <SettingsRow
        label="Export"
        explanation="Every Note and Task as Markdown, in your Downloads folder — nothing kept here is locked in."
      >
        <Button
          variant="outline"
          size="sm"
          onClick={exportJournal}
          disabled={exporting}
        >
          {exporting ? 'Exporting…' : 'Export all to Markdown'}
        </Button>
      </SettingsRow>

      {/* The toast is where the user is looking; this is where the answer
          stays. It is here before there is anything to say, so that what it
          says next is announced rather than merely appearing. */}
      <p
        role="status"
        aria-live="polite"
        className="type-meta text-muted-foreground"
      >
        {exported}
      </p>
    </SettingsGroup>
  )
}
