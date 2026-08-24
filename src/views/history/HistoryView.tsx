import { useEffect, useId, useRef, useState } from 'react'
import { CalendarRangeIcon, ClipboardCopyIcon, SearchIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Toaster } from '@/components/ui/sonner'
import { cn } from '@/lib/utils'
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
  constraintOf,
  decideKeystroke,
  formatJournalDay,
  formatProject,
  formatTimeOfDay,
  journalDayFor,
  projectChoice,
  projectConstraintFor,
  rangeForDays,
  rangeForJournalDay,
  rangeForPreset,
  type Filter,
  type FilterPreset,
  type Journal,
  type ProjectConstraint,
  type Note,
} from '@/journal/journal'
import type { Desktop } from '@/platform/desktop'
import type { HotkeyStatus } from '@/settings/hotkey'
import { formatDayRange } from './range-label'

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
      clipboard: (text) => desktop.copyToClipboard(text),
      // The tray count is kept by another window entirely, and a correction
      // here is the only way it learns that today holds one Note fewer.
      announceChange: () => void desktop.announceJournalChanged(),
      onChange: setSnapshot,
    }),
  )
  const {
    filter,
    projects,
    history,
    term,
    searching,
    nudgedDay,
    confirmation,
    problem,
  } = snapshot

  // The one Note being reworded, and the one waiting on a confirmed deletion.
  // Both are single, and both are about this screen rather than the session: a
  // list only ever has one correction in progress.
  const [editing, setEditing] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Note | null>(null)
  // Only the empty state reads this, and only to teach the fastest way in.
  // Null until the OS has been asked, and after a question it refused.
  const [hotkey, setHotkey] = useState<HotkeyStatus | null>(null)
  // A copy the reader asked for and has not been told about yet. What makes a
  // toast is that a copy was asked for, not that the confirmation reads
  // differently: copying the same Filter twice says the same words both times,
  // and both times the reader asked to be told.
  const copying = useRef(false)
  // Whether a Filter control has a popup open. Its own Escape closes it, and
  // the keystroke still reaches this view through the React tree even though
  // the popup itself is portalled out of it.
  const [picking, setPicking] = useState(false)
  const page = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // A Dock-less app does not reliably hand focus to a new window, and Escape
    // has to reach this view for the window to close.
    page.current?.focus()

    void session.open()
  }, [session])

  useEffect(() => {
    // Every session update is a new snapshot, so a copy is heard even when it
    // confirms in exactly the words the last one did.
    if (!copying.current || snapshot.confirmation === null) return

    copying.current = false
    toast(snapshot.confirmation)
  }, [snapshot])

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

  useEffect(() => {
    // The other way the list stops being true: a sweep imported today's
    // meetings, which never nudges. This window's own corrections are heard
    // here too, and cost one extra read that finds the list exactly as it left
    // it — cheaper than a second event that means almost the same thing.
    const subscription = desktop.onJournalChanged(() => {
      void session.refresh()
    })

    return () => {
      void subscription.then((stop) => stop())
    }
  }, [desktop, session])

  // Escape belongs to whatever has taken the screen over: a correction first,
  // then an open Filter popup, then a Search, and the window when none has.
  // Dismissing the window closes it — History is not kept resident.
  function onKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key !== 'Escape' || editing !== null || deleting !== null) return
    if (picking) return

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

  /** Both ends of the day axis, in the one move that sets them. */
  function pick(from: string, to: string) {
    void session.moveTo(rangeForDays(from, to))
  }

  /**
   * A one-shot named range. The clock is read here and only here; nothing
   * holds the Preset afterwards, so the picked range stays the source of
   * truth for what is on screen.
   */
  function applyPreset(preset: FilterPreset) {
    void session.moveTo(rangeForPreset(preset, journalDayFor(new Date())))
  }

  /** The Digest onto the clipboard, and a toast once it is there. */
  function copyDigest() {
    copying.current = true
    session.copy()
  }

  return (
    <div
      ref={page}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="flex h-screen flex-col bg-background outline-none"
    >
      {/*
        The header wraps rather than clips: the Filter's controls, the Search
        field and the Digest are each the whole of something the reader needs,
        so a narrow window gets a second row instead of a row with its end cut
        off. Nothing up here is optional enough to hide.
      */}
      {filter !== null && (
        <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 px-6 py-4 type-meta text-muted-foreground">
          <DayRangeField
            filter={filter}
            onPick={pick}
            onChoosePreset={applyPreset}
            onOpenChange={setPicking}
          />
          <ProjectConstraintField
            constraint={constraintOf(filter)}
            projects={projects}
            onNarrow={(constraint) => void session.narrowTo(constraint)}
            onOpenChange={setPicking}
          />
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
            <CopyDigest confirmation={confirmation} onCopy={copyDigest} />
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
          <Centred>{nothingHere(filter)}</Centred>
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
                  void session.moveTo(rangeForJournalDay(note.journalDay))
                }
              />
            ))}
          </ol>
        )}
        {history.state === 'notes' &&
          history.days.map((day) => (
            <section key={day.journalDay} className="mb-6 last:mb-0">
              <h2 className="mb-3 type-section text-muted-foreground">
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
          onShow={() => void session.moveTo(rangeForJournalDay(nudgedDay))}
          onDismiss={() => session.dismissNudge()}
        />
      )}

      <ConfirmDelete
        note={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />

      {/* Where a copy says what it did. Nothing else toasts. */}
      <Toaster position="bottom-right" />
    </div>
  )
}

/**
 * An empty list, and which axis emptied it. The day range is what a reader
 * moved last unless they have also narrowed to a Project, and a message
 * naming one axis reads as though the other were not there.
 */
function nothingHere(filter: Filter | null): string {
  if (filter === null) return 'No Notes in these days.'

  const constraint = constraintOf(filter)
  switch (constraint.kind) {
    case 'any':
      return 'No Notes in these days.'
    case 'unfiled':
      return 'No Unfiled Notes in these days.'
    case 'named':
      return `No Notes under #${constraint.name} in these days.`
  }
}

/**
 * A correction the record refused. Above the list rather than inside it: the
 * Note it is about may have moved or may not be on screen at all, and a reader
 * with no devtools to hand has nowhere else to learn that nothing happened.
 */
function Problem({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="shrink-0 px-6 pb-3 type-meta text-destructive">
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
    <li className="group relative flex gap-3 rounded-md px-2 py-1 type-body hover:bg-muted/40 focus-within:bg-muted/40">
      <span className="shrink-0 pt-px font-mono type-meta text-muted-foreground">
        {formatTimeOfDay(note.capturedAt)}
      </span>

      {editing ? (
        <EditBody note={note} onCommit={onCommit} onAbandon={onAbandon} />
      ) : (
        <>
          <button
            type="button"
            onClick={onEdit}
            className={`flex-1 cursor-text rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/30 ${
              // A Note nobody typed reads quieter than one they did, so a
              // scan-and-delete pass down the day is fast. No icon and no
              // label: the weight is the whole of the difference, and a Digest
              // shows none of it — see docs/adr/0010-notes-have-two-origins.md.
              note.origin === 'import' ? 'text-muted-foreground' : ''
            }`}
          >
            <ProjectChip project={note.project} className="mr-2" />
            {note.body}
            {note.editedAt !== null && (
              // Provenance for the reader: the wording is not necessarily the
              // one that was typed at Captured At.
              <span
                className="ml-2 type-meta text-muted-foreground"
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
              <label className="flex items-center gap-1 type-meta text-muted-foreground">
                <span className="sr-only">Project</span>
                <ProjectField
                  value={note.project}
                  journal={journal}
                  onPick={onEditProject}
                  label={`File "${note.body}" under a Project`}
                />
              </label>
              <label className="flex items-center gap-1 type-meta text-muted-foreground">
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
/*
 * The accent marks a filed Project and nothing else on the line. `Unfiled` is
 * the absence of a Project rather than one of them, so it stays quiet.
 */
function ProjectChip({ project, className }: { project: string | null; className?: string }) {
  return (
    <span
      className={cn(
        'shrink-0 font-mono type-meta',
        project === null ? 'text-muted-foreground' : 'text-primary',
        className,
      )}
    >
      {formatProject(project)}
    </span>
  )
}

function ResultLine({ note, onShow }: { note: Note; onShow: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onShow}
        className="flex w-full gap-3 rounded-md px-2 py-1 text-left type-body outline-none hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/30"
      >
        <ProjectChip project={note.project} />
        <span className="flex-1">{note.body}</span>
        <span className="shrink-0 pt-px type-meta text-muted-foreground">
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
      className="flex-1 rounded-md border border-border bg-transparent px-1.5 py-0.5 type-body text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
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
 * Named ranges that set the day axis once and are then forgotten. Nothing
 * holds the one that was chosen: what the reader reads afterwards is the range
 * itself, which is the only thing that is still true a day later.
 */
const PRESET_OPTIONS: ReadonlyArray<{ value: FilterPreset; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'this-week', label: 'This week' },
  { value: 'last-week', label: 'Last week' },
  { value: 'this-month', label: 'This month' },
  { value: 'last-month', label: 'Last month' },
]

/**
 * The Filter's day axis, whole: a button that reads the range in words, and
 * one popup holding both ways to change it — a named range, or two ends on a
 * calendar. One concept, one control.
 *
 * A day is picked in one click and is a whole day when it lands, which is why
 * nothing here holds a half-typed value: the partial-value dance the old date
 * inputs needed is gone with them rather than ported across.
 */
function DayRangeField({
  filter,
  onPick,
  onChoosePreset,
  onOpenChange,
}: {
  filter: Filter
  onPick: (from: string, to: string) => void
  onChoosePreset: (preset: FilterPreset) => void
  onOpenChange: (open: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  // The first end of a range being picked, while the second is still to come.
  // Null whenever the calendar is showing the Filter rather than a new range.
  const [started, setStarted] = useState<Date | null>(null)

  function show(next: boolean) {
    setOpen(next)
    onOpenChange(next)
    if (!next) setStarted(null)
  }

  function pickDay(day: Date) {
    if (started === null) {
      setStarted(day)
      return
    }

    // Whichever end was clicked first: the core orders the range.
    onPick(journalDayFor(started), journalDayFor(day))
    show(false)
  }

  return (
    <Popover open={open} onOpenChange={show}>
      <PopoverTrigger
        render={<Button variant="outline" size="sm" aria-label="Days" />}
      >
        <CalendarRangeIcon data-icon="inline-start" />
        {formatDayRange(filter.from, filter.to)}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto gap-2 p-2">
        <div className="grid grid-cols-3 gap-1">
          {PRESET_OPTIONS.map((option) => (
            <Button
              key={option.value}
              variant="ghost"
              size="sm"
              className="justify-start"
              onClick={() => {
                onChoosePreset(option.value)
                show(false)
              }}
            >
              {option.label}
            </Button>
          ))}
        </div>
        <Calendar
          mode="range"
          autoFocus
          weekStartsOn={1}
          defaultMonth={dayAsDate(filter.to)}
          selected={
            started === null
              ? { from: dayAsDate(filter.from), to: dayAsDate(filter.to) }
              : { from: started, to: undefined }
          }
          onSelect={(_range, day) => pickDay(day)}
          className="p-0"
        />
      </PopoverContent>
    </Popover>
  )
}

/**
 * A Journal Day as the calendar's own kind of value. A `YYYY-MM-DD` label is a
 * civil day rather than an instant, and `journalDayFor` reads a local one back
 * out, so it is built as the local midnight of the day it names.
 */
function dayAsDate(journalDay: string): Date {
  const [year, month, day] = journalDay.split('-').map(Number)
  return new Date(year, month - 1, day)
}

/**
 * The Filter's other axis: every Project, none of them, or one. Sticky, unlike
 * a Preset — it is the narrow the reader is reading under, so it stays until
 * they say otherwise and no Note arriving can move it.
 *
 * The Project on screen is offered even when the list does not hold it, which
 * happens the moment its last Note is deleted or refiled: a picker that
 * silently stopped showing what it is narrowed to would be lying about the
 * empty list underneath it.
 */
function ProjectConstraintField({
  constraint,
  projects,
  onNarrow,
  onOpenChange,
}: {
  constraint: ProjectConstraint
  projects: string[]
  onNarrow: (constraint: ProjectConstraint) => void
  onOpenChange: (open: boolean) => void
}) {
  const chosen = projectChoice(constraint)
  const named =
    constraint.kind === 'named' && !projects.includes(constraint.name)
      ? [constraint.name, ...projects]
      : projects
  const options = [
    { value: 'any', label: 'Any Project' },
    { value: 'unfiled', label: 'Unfiled' },
    ...named.map((name) => ({ value: `#${name}`, label: `#${name}` })),
  ]

  return (
    <Select
      items={options}
      value={chosen}
      onValueChange={(value) => onNarrow(projectConstraintFor(String(value)))}
      onOpenChange={onOpenChange}
    >
      <SelectTrigger size="sm" aria-label="Project" className="max-w-40">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
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
    // the Digest are fixed things, a field is just as usable half as wide. It
    // gives way down to a readable width and then takes a row of its own,
    // rather than shrinking until nothing can be typed into it.
    <label className="relative flex min-w-0 flex-1 basis-40 items-center">
      <span className="sr-only">Search</span>
      <SearchIcon className="pointer-events-none absolute left-2 size-3 text-muted-foreground" />
      <Input
        type="search"
        value={term}
        onChange={(event) => onType(event.target.value)}
        placeholder="Search"
        className="h-6 w-full min-w-0 pl-6 type-meta [&::-webkit-search-cancel-button]:hidden"
      />
    </label>
  )
}

/**
 * The journal's one output, and the header's one primary action. The
 * confirmation is not a decoration: a clipboard write is invisible, so a count
 * is how the reader knows it worked before they paste. It is said twice, in
 * the two ways a confirmation has to be said — a toast for whoever is looking
 * at the screen, and a live region for whoever is not.
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
      <span role="status" aria-live="polite" className="sr-only">
        {confirmation}
      </span>
      <Button size="sm" onClick={onCopy}>
        <ClipboardCopyIcon data-icon="inline-start" />
        Copy Digest
      </Button>
    </div>
  )
}

/**
 * A Journal Day being edited, which is not the same as one being typed. A date
 * input that already holds a day reports a whole, shaped value on every
 * segment a keystroke touches, so typing the year `2026` announces `0002`,
 * `0020` and `0202` first. Committing those would refile a Note three times on
 * the way to the day the reader meant.
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
      className="rounded-md border border-border bg-transparent px-1.5 py-0.5 type-meta text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
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
        className="w-24 rounded-md border border-border bg-transparent px-1.5 py-0.5 font-mono type-meta text-foreground outline-none placeholder:font-sans placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
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
      className="flex shrink-0 items-center gap-3 border-t border-border bg-muted/40 px-6 py-3 type-meta"
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
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center type-body">
      {children}
    </div>
  )
}
