import { useEffect, useRef, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import {
  formatJournalDay,
  formatTimeOfDay,
  groupByJournalDay,
  type JournalDayGroup,
} from '@/journal/journal'
import { journal } from '@/journal/tauri-journal'

/** What History has to show, once the core has been asked. */
type History =
  | { state: 'loading' }
  | { state: 'empty' }
  | { state: 'notes'; days: JournalDayGroup[] }
  | { state: 'unreadable' }

/**
 * Reading back what you did. The window behind this view is created on demand
 * and genuinely closed on dismiss, so the view loads once on mount and needs no
 * reset — see docs/adr/0002-capture-window-is-hidden-never-closed.md.
 */
export default function HistoryView() {
  const [history, setHistory] = useState<History>({ state: 'loading' })
  const page = useRef<HTMLElement>(null)

  useEffect(() => {
    // A Dock-less app does not reliably hand focus to a new window, and Escape
    // has to reach this view for the window to close.
    page.current?.focus()

    let current = true

    void (async () => {
      try {
        const core = await journal()
        // The Filter opens on the most recent Occupied Day, whenever that was;
        // with no Notes at all there is no day to open on.
        const filter = await core.defaultFilter()
        if (filter === null) {
          if (current) setHistory({ state: 'empty' })
          return
        }

        const days = groupByJournalDay(await core.notesForFilter(filter))
        if (current) setHistory({ state: 'notes', days })
      } catch (error) {
        // Better to say the journal could not be read than to leave a window
        // that never stops loading.
        console.error('could not read the journal', error)
        if (current) setHistory({ state: 'unreadable' })
      }
    })()

    return () => {
      current = false
    }
  }, [])

  // Escape dismisses, and dismissing closes: History is not kept resident.
  function onKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      void getCurrentWindow().close()
    }
  }

  return (
    <main
      ref={page}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="h-screen overflow-y-auto bg-background px-6 py-5 outline-none"
    >
      {history.state === 'empty' && <EmptyState />}
      {history.state === 'unreadable' && (
        <Centred>The journal could not be read.</Centred>
      )}
      {history.state === 'notes' &&
        history.days.map((day) => (
          <section key={day.journalDay} className="mb-6 last:mb-0">
            <h2 className="mb-3 text-sm font-medium text-muted-foreground">
              {formatJournalDay(day.journalDay)}
            </h2>
            <ol className="flex flex-col gap-3">
              {day.notes.map((note) => (
                <li key={note.id} className="flex gap-3 text-sm">
                  <span className="shrink-0 pt-px font-mono text-xs tabular-nums text-muted-foreground">
                    {formatTimeOfDay(note.capturedAt)}
                  </span>
                  <span>{note.body}</span>
                </li>
              ))}
            </ol>
          </section>
        ))}
    </main>
  )
}

/** No Notes at all is a beginning, not an empty day. */
function EmptyState() {
  return (
    <Centred>
      <p className="font-medium">No Notes yet</p>
      <p className="text-muted-foreground">
        Choose New Note from the Work Journal menu, type one line about what you
        just did, and press Enter.
      </p>
    </Centred>
  )
}

function Centred({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm">
      {children}
    </div>
  )
}
