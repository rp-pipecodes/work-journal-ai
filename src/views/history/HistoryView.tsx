import { useEffect, useId, useRef, useState } from 'react'
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
  filterForPreset,
  filterForRange,
  formatJournalDay,
  formatProject,
  formatTimeOfDay,
  journalDayFor,
  type Filter,
  type FilterPreset,
  type Journal,
  type Note,
} from '@/journal/journal'
import { copyToClipboard } from '@/lib/clipboard'
import type { Desktop } from '@/platform/desktop'
import type { HotkeyStatus } from '@/settings/hotkey'

/**
 * Reading back what you did. Every rule of reading back — where the Filter
 * opens, what an arrival does to it, what a correction re-reads — belongs to
 * the History session; this view renders its snapshot and calls its verbs.
 *
 * The window behind the view is created on demand and genuinely closed on
 * dismiss, so the session is built once per window and needs no reset — see
 * docs/adr/0002-capture-window-is-hidden-never-closed.md.
 */
export default function HistoryView({
  desktop,
  journal,
}: {
  desktop: Desktop
  journal: Promise<Journal>
}) {
  const [snapshot, setSnapshot] = useState<HistorySnapshot>(openingSnapshot)
  const [session] = useState(() =>
    createHistorySession({
      journal,
      clipboard: copyToClipboard,
      onChange: setSnapshot,
    }),
  )
  const { filter, history, term, searching, nudgedDay, confirmation, problem } =
    snapshot

  // The one Note being reworded, and the one waiting on a confirmed deletion.
  // Both are single, and both are about this screen rather than the session: a
  // list only ever has one correction in progress.
  const [editing, setEditing] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Note | null>(null)
  // Only the empty state reads this, and only to teach the fastest way in.
  // Null until the OS has been asked, and after a question it refused.
  const [hotkey, setHotkey] = useState<HotkeyStatus | null>(null)
  const page = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // A Dock-less app does not reliably hand focus to a new window, and Escape
    // has to reach this view for the window to close.
    page.current?.focus()

    void session.open()
  }, [session])

  useEffect(() => {
    desktop.hotkeyStatus().then(setHotkey, (error: unknown) => {
      // The Hotkey is not what this window is for: a status that cannot be
      // read leaves the empty state on the Tray Menu wording rather than
      // saying anything about it.
      console.error('could not read the hotkey', error)
    })
  }, [desktop])

  useEffect(() => {
    const subscription = desktop.onNoteCaptured((journalDay) => {
      void session.noteArrived(journalDay)
    })

    return () => {
      void subscription.then((stop) => stop())
    }
  }, [desktop, session])

  // Escape belongs to whatever has taken the screen over: a correction first,
  // then a Search, and the window when neither has. Dismissing the window
  // closes it — History is not kept resident.
  function onKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key !== 'Escape' || editing !== null || deleting !== null) return

    if (searching) {
      // Clears the results and empties the field; the window stays open.
      void session.search('')
      return
    }

    void desktop.closeWindow()
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

  function editProject(note: Note, project: string | null) {
    void session.editProject(note.id, project)
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

  /**
   * A one-shot named range. The clock is read here and only here; the select
   * snaps back, so the pickers stay the source of truth for what is on screen.
   */
  function applyPreset(preset: FilterPreset) {
    void session.moveTo(filterForPreset(preset, journalDayFor(new Date())))
  }

  return (
    <div
      ref={page}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="flex h-screen flex-col bg-background outline-none"
    >
      {filter !== null && (
        <header className="flex shrink-0 items-center gap-3 overflow-hidden px-6 py-4 text-xs text-muted-foreground">
          <Range filter={filter} onPick={pick} />
          <Preset onChoose={applyPreset} />
          <SearchField
            term={term}
            onType={(typed) => void session.search(typed)}
          />
          {/*
            Gone while a Search is showing: the Digest is bound to the Filter,
            and a button that copies something not on screen is how the wrong
            month reaches a standup thread.
          */}
          {!searching && (
            <CopyDigest
              confirmation={confirmation}
              onCopy={() => session.copy()}
            />
          )}
        </header>
      )}

      {problem !== null && <Problem>{problem}</Problem>}

      <main className="flex-1 overflow-y-auto px-6 pb-5">
        {history.state === 'empty' && <EmptyState hotkey={hotkey} />}
        {history.state === 'unreadable' && (
          <Centred>The journal could not be read.</Centred>
        )}
        {history.state === 'notes' && history.days.length === 0 && (
          <Centred>No Notes in these days.</Centred>
        )}
        {history.state === 'results' && history.notes.length === 0 && (
          <Centred>No Notes say “{history.term}”.</Centred>
        )}
        {history.state === 'results' && history.notes.length > 0 && (
          <ol className="flex flex-col gap-1">
            {history.notes.map((note) => (
              <ResultLine
                key={note.id}
                note={note}
                onShow={() =>
                  void session.moveTo(filterForJournalDay(note.journalDay))
                }
              />
            ))}
          </ol>
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
                    journal={journal}
                    editing={editing === note.id}
                    onEdit={() => setEditing(note.id)}
                    onCommit={(body) => commitEdit(note, body)}
                    onAbandon={() => setEditing(null)}
                    onRefile={(journalDay) => refile(note, journalDay)}
                    onEditProject={(project) => editProject(note, project)}
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
 * A correction the record refused. Above the list rather than inside it: the
 * Note it is about may have moved or may not be on screen at all, and a reader
 * with no devtools to hand has nowhere else to learn that nothing happened.
 */
function Problem({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="shrink-0 px-6 pb-3 text-xs text-destructive">
      {children}
    </p>
  )
}

/**
 * One Note as it reads now, and the ways to correct it. The actions stay out
 * of the way until the row is hovered or something in it has focus, so a list
 * being read back is a list of Notes rather than a list of controls.
 */
function NoteLine({
  note,
  journal,
  editing,
  onEdit,
  onCommit,
  onAbandon,
  onRefile,
  onEditProject,
  onDelete,
}: {
  note: Note
  journal: Promise<Journal>
  editing: boolean
  onEdit: () => void
  onCommit: (body: string) => void
  onAbandon: () => void
  onRefile: (journalDay: string) => void
  onEditProject: (project: string | null) => void
  onDelete: () => void
}) {
  return (
    <li className="group relative flex gap-3 rounded-md px-2 py-1 text-sm hover:bg-muted/40 focus-within:bg-muted/40">
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
            <span className="mr-2 shrink-0 font-mono text-xs text-muted-foreground">
              {formatProject(note.project)}
            </span>
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

            Laid over the row's trailing edge rather than beside it, because a
            control nobody can see should not be taking width off the Body —
            and taking it back on hover would rewrap the line under the cursor.
            The Body keeps the whole row and the actions cover its tail while
            they are up, which is why the layer is opaque: the two backgrounds
            below compose to exactly the row's own `bg-muted/40` over
            `bg-background`.

            Up on the row's hover, but only on these controls' own focus: what
            covers the end of a line has to be something the reader asked for,
            and tabbing to the Body is asking to read it.
          */}
          <div className="absolute inset-y-1 right-2 flex items-center rounded-md bg-background opacity-0 transition-opacity pointer-events-none group-hover:pointer-events-auto group-hover:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100">
            <div className="flex h-full items-center gap-1 rounded-md bg-muted/40 pl-3">
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                <span className="sr-only">Project</span>
                <ProjectField
                  value={note.project}
                  journal={journal}
                  onPick={onEditProject}
                  label={`File "${note.body}" under a Project`}
                />
              </label>
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                <span className="sr-only">File under</span>
                <DayField
                  value={note.journalDay}
                  onPick={onRefile}
                  label={`File "${note.body}" under another day`}
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
          </div>
        </>
      )}
    </li>
  )
}

/**
 * One Search result: what the Note says, and the day it is filed under. The
 * whole row is the way in, because answering a result has exactly one meaning
 * — take History to that day in full. The Notes are not correctable here: a
 * result is a signpost to a day, and the day is where the list lives.
 */
function ResultLine({ note, onShow }: { note: Note; onShow: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onShow}
        className="flex w-full gap-3 rounded-md px-2 py-1 text-left text-sm outline-none hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/30"
      >
        <span className="shrink-0 font-mono text-xs text-muted-foreground">
          {formatProject(note.project)}
        </span>
        <span className="flex-1">{note.body}</span>
        <span className="shrink-0 pt-px text-xs text-muted-foreground">
          {formatJournalDay(note.journalDay)}
        </span>
      </button>
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
 * Named ranges that set the Filter once and are forgotten. Controlled on the
 * empty value so every choice snaps back to the neutral label; the pickers
 * remain what shows the range on screen.
 */
const PRESET_OPTIONS: ReadonlyArray<{ value: FilterPreset; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'this-week', label: 'This week' },
  { value: 'last-week', label: 'Last week' },
  { value: 'this-month', label: 'This month' },
  { value: 'last-month', label: 'Last month' },
]

function Preset({ onChoose }: { onChoose: (preset: FilterPreset) => void }) {
  return (
    <label className="flex shrink-0 items-center gap-1.5">
      <span className="sr-only">Preset</span>
      <select
        value=""
        onChange={(event) => {
          const value = event.target.value
          if (value === '') return
          onChoose(value as FilterPreset)
        }}
        className="rounded-md border border-border bg-transparent px-1.5 py-0.5 text-xs text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
      >
        <option value="">Preset</option>
        {PRESET_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

/**
 * What the reader is looking for, anywhere in the journal. The field holds the
 * term the session holds, so clearing the Search with Escape empties it
 * without the view keeping a second copy of the truth — and the debounce, the
 * two-character threshold and which read may land are the session's, not this
 * input's.
 */
function SearchField({
  term,
  onType,
}: {
  term: string
  onType: (term: string) => void
}) {
  return (
    // The one control that gives way when the window is narrow: the Filter and
    // the Digest are fixed things, a field is just as usable half as wide.
    <label className="flex min-w-0 flex-1 items-center gap-1.5">
      <span className="sr-only">Search</span>
      <input
        type="search"
        value={term}
        onChange={(event) => onType(event.target.value)}
        placeholder="Search"
        className="w-full min-w-0 rounded-md border border-border bg-transparent px-1.5 py-0.5 text-xs text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
      />
    </label>
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
    <div className="ml-auto flex shrink-0 items-center gap-3">
      {/* Empty until something has been copied, and announced when it is. */}
      <span role="status" aria-live="polite">
        {confirmation}
      </span>
      <Button variant="outline" size="sm" onClick={onCopy}>
        Copy Digest
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
    <label className="flex shrink-0 items-center gap-1.5">
      <span>{label}</span>
      <DayField value={value} onPick={onChange} />
    </label>
  )
}

/**
 * A Journal Day being edited, which is not the same as one being typed. A date
 * input that already holds a day — both of these always do — reports a whole,
 * shaped value on every segment a keystroke touches, so typing the year `2026`
 * announces `0002`, `0020` and `0202` first. Committing those would refile a
 * Note three times on the way to the day the reader meant.
 *
 * So the typing is kept here and only the settled value leaves: the picked day
 * is announced when the field is left, or when the picker itself commits one.
 * The core refuses a nonsense day regardless — that guard is the one that
 * matters — but a field that asks three times is wrong even when it is refused.
 */
function DayField({
  value,
  onPick,
  label,
}: {
  value: string
  onPick: (value: string) => void
  label?: string
}) {
  const [typed, setTyped] = useState(value)
  const [settled, setSettled] = useState(value)

  // The day changed underneath us — a refile landed, or the Filter moved — so
  // what is being typed is stale and the field goes back to showing the truth.
  if (value !== settled) {
    setSettled(value)
    setTyped(value)
  }

  function commit() {
    if (typed === value) return

    onPick(typed)
    // The field goes back to the day on record, and gets there again only if
    // the pick is accepted: a blank or refused day never lingers on screen as
    // though it had been filed.
    setTyped(value)
  }

  return (
    <input
      type="date"
      value={typed}
      onChange={(event) => setTyped(event.target.value)}
      onBlur={commit}
      // Enter is how the keyboard says it is done without leaving the field.
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          commit()
        }
      }}
      aria-label={label}
      className="rounded-md border border-border bg-transparent px-1.5 py-0.5 text-xs tabular-nums text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
    />
  )
}

/**
 * A Note's Project being set, changed or cleared. Explicit — not the Body —
 * so wording and filing stay separate. Offers Projects currently on Notes via
 * a datalist, and accepts a new name; emptying the field clears to Unfiled.
 * Settles on blur or Enter, like a Journal Day.
 */
function ProjectField({
  value,
  journal,
  onPick,
  label,
}: {
  value: string | null
  journal: Promise<Journal>
  onPick: (project: string | null) => void
  label?: string
}) {
  const shown = value ?? ''
  const [typed, setTyped] = useState(shown)
  const [settled, setSettled] = useState(shown)
  const [projects, setProjects] = useState<string[]>([])
  // Escape sets this before blur so commit does not fire the abandoned value.
  const abandon = useRef(false)
  const listId = useId()

  if (shown !== settled) {
    setSettled(shown)
    setTyped(shown)
  }

  function commit() {
    if (abandon.current) {
      abandon.current = false
      setTyped(shown)
      return
    }

    // A leading # is the display form; filing takes the bare name.
    const name = typed.trim().replace(/^#/, '')
    const project = name === '' ? null : name
    if (
      project === value ||
      (project !== null && project.toLowerCase() === value)
    ) {
      setTyped(shown)
      return
    }

    onPick(project)
    setTyped(shown)
  }

  return (
    <>
      <input
        type="text"
        value={typed}
        list={listId}
        spellCheck={false}
        autoComplete="off"
        placeholder="Unfiled"
        onChange={(event) => setTyped(event.target.value)}
        onFocus={() => {
          void (async () => {
            setProjects(await (await journal).projectPredictions(''))
          })()
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            commit()
          }
          if (event.key === 'Escape') {
            // Abandon the edit; keep the window open.
            event.stopPropagation()
            abandon.current = true
            setTyped(shown)
            event.currentTarget.blur()
          }
        }}
        aria-label={label}
        className="w-24 rounded-md border border-border bg-transparent px-1.5 py-0.5 font-mono text-xs text-foreground outline-none placeholder:font-sans placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
      />
      <datalist id={listId}>
        {projects.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
    </>
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

/**
 * No Notes at all is a beginning, not an empty day — and the one screen a new
 * user is guaranteed to read, so it teaches the Hotkey: the fastest Entry
 * Point, named as the combination actually bound rather than in the abstract.
 *
 * The Tray Menu is the fallback, and is all this says when the Hotkey is
 * unavailable or unknown: an empty state that taught a combination doing
 * nothing would be worse than the slow way in.
 */
function EmptyState({ hotkey }: { hotkey: HotkeyStatus | null }) {
  return (
    <Centred>
      <p className="font-medium">No Notes yet</p>
      {hotkey?.state === 'registered' ? (
        <p className="text-muted-foreground">
          Press <span className="font-mono">{hotkey.hotkey}</span>, type one
          line about what you just did, and press Enter. New Note in the Work
          Journal menu does the same thing.
        </p>
      ) : (
        <p className="text-muted-foreground">
          Choose New Note from the Work Journal menu, type one line about what
          you just did, and press Enter.
        </p>
      )}
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
