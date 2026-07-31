import { useEffect, useRef, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  createHistorySession,
  openingSnapshot,
  type HistorySnapshot,
} from '@/journal/history-session'
import {
  decideKeystroke,
  filterForJournalDay,
  filterForRange,
  formatJournalDay,
  formatTimeOfDay,
  type Filter,
  type Note,
} from '@/journal/journal'
import { journal, onNoteCaptured } from '@/journal/tauri-journal'
import { copyToClipboard } from '@/lib/clipboard'

/**
 * Reading back what you did. Every rule of reading back — where the Filter
 * opens, what an arrival does to it, what a correction re-reads — belongs to
 * the History session; this view renders its snapshot and calls its verbs.
 *
 * The window behind the view is created on demand and genuinely closed on
 * dismiss, so the session is built once per window and needs no reset — see
 * docs/adr/0002-capture-window-is-hidden-never-closed.md.
 */
export default function HistoryView() {
  const [snapshot, setSnapshot] = useState<HistorySnapshot>(openingSnapshot)
  const [session] = useState(() =>
    createHistorySession({
      journal: journal(),
      clipboard: copyToClipboard,
      onChange: setSnapshot,
    }),
  )
  const { filter, history, nudgedDay, confirmation } = snapshot

  // The one Note being reworded, and the one waiting on a confirmed deletion.
  // Both are single, and both are about this screen rather than the session: a
  // list only ever has one correction in progress.
  const [editing, setEditing] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Note | null>(null)
  const page = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // A Dock-less app does not reliably hand focus to a new window, and Escape
    // has to reach this view for the window to close.
    page.current?.focus()

    void session.open()
  }, [session])

  useEffect(() => {
    const subscription = onNoteCaptured((journalDay) => {
      void session.noteArrived(journalDay)
    })

    return () => {
      void subscription.then((stop) => stop())
    }
  }, [session])

  // Escape dismisses, and dismissing closes: History is not kept resident.
  // While a correction is open, Escape belongs to it — abandoning an edit or a
  // confirmation must not take the window with it.
  function onKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape' && editing === null && deleting === null) {
      void getCurrentWindow().close()
    }
  }

  function commitEdit(note: Note, body: string) {
    setEditing(null)
    void session.editBody(note.id, body)
  }

  function refile(note: Note, journalDay: string) {
    // A cleared date input is a half-picked day, not a day to file under.
    if (journalDay === '') return
    void session.refile(note.id, journalDay)
  }

  /** The one irreversible operation, and the only one that is confirmed. */
  function confirmDelete(note: Note) {
    setDeleting(null)
    void session.delete(note.id)
  }

  /** A cleared date input is a half-picked range, not a Filter over nothing. */
  function pick(from: string, to: string) {
    if (from === '' || to === '') return
    void session.moveTo(filterForRange(from, to))
  }

  return (
    <div
      ref={page}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="flex h-screen flex-col bg-background outline-none"
    >
      {filter !== null && (
        <header className="flex shrink-0 items-center gap-3 px-6 py-4 text-xs text-muted-foreground">
          <Range filter={filter} onPick={pick} />
          <CopyDigest
            confirmation={confirmation}
            onCopy={() => session.copy()}
          />
        </header>
      )}

      <main className="flex-1 overflow-y-auto px-6 pb-5">
        {history.state === 'empty' && <EmptyState />}
        {history.state === 'unreadable' && (
          <Centred>The journal could not be read.</Centred>
        )}
        {history.state === 'notes' && history.days.length === 0 && (
          <Centred>No Notes in these days.</Centred>
        )}
        {history.state === 'notes' &&
          history.days.map((day) => (
            <section key={day.journalDay} className="mb-6 last:mb-0">
              <h2 className="mb-3 text-sm font-medium text-muted-foreground">
                {formatJournalDay(day.journalDay)}
              </h2>
              <ol className="flex flex-col gap-1">
                {day.notes.map((note) => (
                  <NoteLine
                    key={note.id}
                    note={note}
                    editing={editing === note.id}
                    onEdit={() => setEditing(note.id)}
                    onCommit={(body) => commitEdit(note, body)}
                    onAbandon={() => setEditing(null)}
                    onRefile={(journalDay) => refile(note, journalDay)}
                    onDelete={() => setDeleting(note)}
                  />
                ))}
              </ol>
            </section>
          ))}
      </main>

      {nudgedDay !== null && (
        <Nudge
          journalDay={nudgedDay}
          onShow={() => void session.moveTo(filterForJournalDay(nudgedDay))}
          onDismiss={() => session.dismissNudge()}
        />
      )}

      <ConfirmDelete
        note={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  )
}

/**
 * One Note as it reads now, and the three ways to correct it. The actions stay
 * out of the way until the row is hovered or something in it has focus, so a
 * list being read back is a list of Notes rather than a list of controls.
 */
function NoteLine({
  note,
  editing,
  onEdit,
  onCommit,
  onAbandon,
  onRefile,
  onDelete,
}: {
  note: Note
  editing: boolean
  onEdit: () => void
  onCommit: (body: string) => void
  onAbandon: () => void
  onRefile: (journalDay: string) => void
  onDelete: () => void
}) {
  return (
    <li className="group flex gap-3 rounded-md px-2 py-1 text-sm hover:bg-muted/40 focus-within:bg-muted/40">
      <span className="shrink-0 pt-px font-mono text-xs tabular-nums text-muted-foreground">
        {formatTimeOfDay(note.capturedAt)}
      </span>

      {editing ? (
        <EditBody note={note} onCommit={onCommit} onAbandon={onAbandon} />
      ) : (
        <>
          <button
            type="button"
            onClick={onEdit}
            className="flex-1 cursor-text rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
          >
            {note.body}
            {note.editedAt !== null && (
              // Provenance for the reader: the wording is not necessarily the
              // one that was typed at Captured At.
              <span
                className="ml-2 text-xs text-muted-foreground"
                title="Changed since it was captured"
              >
                edited
              </span>
            )}
          </button>

          {/*
            Out of the way until wanted, and genuinely out of the way: an
            invisible control is not one to click by accident. Kept focusable
            rather than hidden, so tabbing to it reveals it.
          */}
          <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity pointer-events-none group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              <span className="sr-only">File under</span>
              <input
                type="date"
                value={note.journalDay}
                onChange={(event) => onRefile(event.target.value)}
                aria-label={`File "${note.body}" under another day`}
                className="rounded-md border border-border bg-transparent px-1.5 py-0.5 text-xs tabular-nums text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
              />
            </label>
            <Button
              variant="ghost"
              size="sm"
              onClick={onDelete}
              aria-label={`Delete "${note.body}"`}
            >
              Delete
            </Button>
          </div>
        </>
      )}
    </li>
  )
}

/**
 * A Body being reworded. Enter commits and Escape abandons — the same bargain
 * a Capture makes, so correcting a Note is the interaction that wrote it.
 */
function EditBody({
  note,
  onCommit,
  onAbandon,
}: {
  note: Note
  onCommit: (body: string) => void
  onAbandon: () => void
}) {
  const [body, setBody] = useState(note.body)

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    const decision = decideKeystroke(event.key, body)
    if (decision === 'ignore') return

    // Escape here abandons the edit; the window stays open.
    event.stopPropagation()
    if (decision === 'commit') {
      onCommit(body)
    } else {
      onAbandon()
    }
  }

  return (
    <input
      autoFocus
      value={body}
      onChange={(event) => setBody(event.target.value)}
      onKeyDown={onKeyDown}
      onBlur={onAbandon}
      aria-label="Body"
      className="flex-1 rounded-md border border-border bg-transparent px-1.5 py-0.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
    />
  )
}

/**
 * The guard on the one irreversible operation. There is no trash and no undo,
 * so the confirmation says plainly that this is permanent.
 */
function ConfirmDelete({
  note,
  onConfirm,
  onCancel,
}: {
  note: Note | null
  onConfirm: (note: Note) => void
  onCancel: () => void
}) {
  return (
    <AlertDialog
      open={note !== null}
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this Note?</AlertDialogTitle>
          <AlertDialogDescription>
            “{note?.body}” will be gone for good. There is no trash and no undo.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => note !== null && onConfirm(note)}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/**
 * The two ends of the Filter. Both are Journal Days rather than instants, which
 * is exactly what a date input edits.
 */
function Range({
  filter,
  onPick,
}: {
  filter: Filter
  onPick: (from: string, to: string) => void
}) {
  return (
    <>
      <End
        label="From"
        value={filter.from}
        onChange={(from) => onPick(from, filter.to)}
      />
      <End
        label="To"
        value={filter.to}
        onChange={(to) => onPick(filter.from, to)}
      />
    </>
  )
}

/**
 * The journal's one output, and what it says it did. The confirmation is not a
 * decoration: a clipboard write is invisible, so a count is how the reader
 * knows it worked before they paste.
 */
function CopyDigest({
  confirmation,
  onCopy,
}: {
  confirmation: string | null
  onCopy: () => void
}) {
  return (
    <div className="ml-auto flex items-center gap-3">
      {/* Empty until something has been copied, and announced when it is. */}
      <span role="status" aria-live="polite">
        {confirmation}
      </span>
      <Button variant="outline" size="sm" onClick={onCopy}>
        Copy All
      </Button>
    </div>
  )
}

function End({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="flex items-center gap-1.5">
      <span>{label}</span>
      <input
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-md border border-border bg-transparent px-1.5 py-0.5 text-xs tabular-nums text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
      />
    </label>
  )
}

/**
 * A day outside the Filter has gained a Note. Unobtrusive on purpose: it says
 * what happened and waits, rather than moving what is being read.
 */
function Nudge({
  journalDay,
  onShow,
  onDismiss,
}: {
  journalDay: string
  onShow: () => void
  onDismiss: () => void
}) {
  return (
    <div
      role="status"
      className="flex shrink-0 items-center gap-3 border-t border-border bg-muted/40 px-6 py-3 text-xs"
    >
      <span className="flex-1 text-muted-foreground">
        A new Note on {formatJournalDay(journalDay)}.
      </span>
      <Button variant="outline" size="sm" onClick={onShow}>
        Show
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={onDismiss}
        aria-label="Dismiss"
      >
        Dismiss
      </Button>
    </div>
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
