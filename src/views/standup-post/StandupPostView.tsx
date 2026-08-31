import { useEffect, useState } from 'react'
import WindowTitleBar from '@/components/WindowTitleBar'
import { formatJournalDay, type Clock, type Journal } from '@/journal/journal'
import {
  createStandupPostSession,
  type StandupPostState,
} from '@/journal/standup-post-session'
import type { Desktop } from '@/platform/desktop'
import type { StandupPostSelection } from '@/journal/standup-post'

/**
 * The read-only preview of the material a future Standup Post call would use.
 * It deliberately has no Generate action: this ticket makes the input visible
 * and keeps the model/network call for the next ticket.
 */
export default function StandupPostView({
  desktop,
  journal,
  clock,
}: {
  desktop: Desktop
  journal: Promise<Journal>
  clock: Clock
}) {
  const [state, setState] = useState<StandupPostState>({ state: 'loading' })
  const [session] = useState(() =>
    createStandupPostSession({ journal, desktop, clock, onChange: setState }),
  )

  useEffect(() => {
    void session.start()

    return () => {
      session.stop()
    }
  }, [session])

  function onKeyDown(event: React.KeyboardEvent<HTMLElement>): void {
    if (event.key === 'Escape') void desktop.closeWindow()
  }

  return (
    <div
      tabIndex={-1}
      onKeyDown={onKeyDown}
      data-section="standup-post"
      className="relative flex h-screen flex-col bg-background outline-none"
    >
      <WindowTitleBar />

      <header className="shrink-0 px-6 py-4">
        <h1 className="type-section">Standup Post</h1>
        <p className="pt-1 type-meta text-muted-foreground">
          See what would be sent before a model call is made.
        </p>
      </header>

      <main className="flex-1 overflow-y-auto px-6 pb-5">
        {state.state === 'loading' && (
          <p role="status" className="type-meta text-muted-foreground">
            Reading the journal…
          </p>
        )}

        {state.state === 'unreadable' && (
          <p role="alert" className="type-meta text-destructive">
            The Standup Post material could not be read.
          </p>
        )}

        {state.state === 'ready' && <MaterialSummary selection={state.selection} />}
      </main>
    </div>
  )
}

function MaterialSummary({ selection }: { selection: StandupPostSelection }) {
  const empty =
    selection.notes.length === 0 &&
    selection.completedTasks.length === 0 &&
    selection.openTasks.length === 0

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <p className="type-meta text-muted-foreground">
        Yesterday: {formatJournalDay(selection.yesterday)}
      </p>

      <section aria-labelledby="standup-yesterday-heading" className="flex flex-col gap-2">
        <h2 id="standup-yesterday-heading" className="type-section">
          Yesterday
        </h2>
        <p className="type-meta text-muted-foreground">
          {count(selection.notes.length, 'Note')}
        </p>
        <p className="type-meta text-muted-foreground">
          {count(selection.completedTasks.length, 'Completed Task')}
        </p>
      </section>

      <section aria-labelledby="standup-open-heading" className="flex flex-col gap-2">
        <h2 id="standup-open-heading" className="type-section">
          Still to do
        </h2>
        <p className="type-meta text-muted-foreground">
          {count(selection.openTasks.length, 'Open Task')}
        </p>
      </section>

      {empty && (
        <p className="type-section text-muted-foreground">Nothing to say yet.</p>
      )}
    </div>
  )
}

function count(value: number, noun: string): string {
  return `${value} ${noun}${value === 1 ? '' : 's'}`
}
