import { useEffect, useId, useRef, useState } from 'react'
import {
  CheckCircle2Icon,
  ListTodoIcon,
  PlusIcon,
  Trash2Icon,
  TriangleAlertIcon,
  type LucideIcon,
} from 'lucide-react'
import WindowTitleBar from '@/components/WindowTitleBar'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Kbd, KbdGroup } from '@/components/ui/kbd'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
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
  createTasksSession,
  openingTasksSnapshot,
  type TasksSnapshot,
} from '@/journal/tasks-session'
import {
  formatTaskCompletedAt,
  type Journal,
  type Task,
} from '@/journal/journal'
import type { Desktop } from '@/platform/desktop'
import { keysOfHotkey, type HotkeyStatuses } from '@/settings/hotkey'

/**
 * Managing what you owe. Every rule of the two lists — which one opens, what a
 * change re-reads, what a refusal says — belongs to the Tasks session; this
 * view renders its snapshot and calls its verbs.
 *
 * The window behind the view is created on demand and genuinely closed on
 * dismiss, so the session is built once per window and needs no reset. It may
 * sit beside History: Tasks are organized prospectively and Notes
 * retrospectively, so neither window answers the other's question.
 */
export default function TasksView({
  desktop,
  journal,
}: {
  desktop: Desktop
  journal: Promise<Journal>
}) {
  const [snapshot, setSnapshot] = useState<TasksSnapshot>(openingTasksSnapshot)
  const [session] = useState(() =>
    createTasksSession({
      journal,
      // A Task Creation window and a second Tasks View both learn of a change
      // here only by being told.
      announceChange: () => void desktop.announceTasksChanged(),
      onChange: setSnapshot,
    }),
  )
  const { showing, tasks, problem } = snapshot

  // The one Task being reworded in the Editor, and the one waiting on a
  // confirmed deletion. Both are single, and both are about this screen rather
  // than the session: a list only ever has one change in progress.
  const [editing, setEditing] = useState<Task | null>(null)
  const [deleting, setDeleting] = useState<Task | null>(null)
  // Only the empty state reads this, and only to teach the fastest way in.
  // Null until the OS has been asked, and after a question it refused.
  const [hotkeys, setHotkeys] = useState<HotkeyStatuses | null>(null)
  const page = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // A Dock-less app does not reliably hand focus to a new window, and Escape
    // has to reach this view for the window to close.
    page.current?.focus()

    void session.open()
  }, [session])

  useEffect(() => {
    desktop.hotkeyStatus().then(setHotkeys, (error: unknown) => {
      // The Hotkey is not what this window is for: a status that cannot be read
      // leaves the empty state on the Tray Menu wording.
      console.error('could not read the hotkeys', error)
    })
  }, [desktop])

  useEffect(() => {
    // A Task created in the Task Creation window, or changed in another Tasks
    // View. This window's own changes are heard here too, and cost one extra
    // read that finds the list exactly as it left it.
    const subscription = desktop.onTasksChanged(() => {
      void session.refresh()
    })

    return () => {
      void subscription.then((stop) => stop())
    }
  }, [desktop, session])

  // Escape belongs to whatever has taken the screen over: the Editor first,
  // then the deletion, and the window when neither has. Dismissing the window
  // closes it — Tasks View is not kept resident.
  function onKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key !== 'Escape') return

    if (editing !== null) {
      // Closing the Editor discards, exactly as Cancel does.
      setEditing(null)
      return
    }
    if (deleting !== null) return

    void desktop.closeWindow()
  }

  function commitEdit(task: Task, description: string) {
    setEditing(null)
    void session.editDescription(task.id, description)
  }

  /** The one irreversible operation, and the only one that is confirmed. */
  function confirmDelete(task: Task) {
    setDeleting(null)
    void session.delete(task.id)
  }

  const list = tasks.state === 'tasks' ? tasks.tasks : []

  return (
    <div
      ref={page}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="relative flex h-screen flex-col bg-background outline-none"
    >
      <WindowTitleBar />

      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 px-6 py-4 type-meta text-muted-foreground">
        <ToggleGroup
          aria-label="Which Tasks to show"
          spacing={0}
          className="gap-0 rounded-md bg-muted p-0.5"
          value={[showing]}
          onValueChange={(next) => {
            // Pressing the list already showing deselects it, which is not a
            // list at all — one of the two is always on screen.
            const chosen = next[0]
            if (chosen === 'open' || chosen === 'completed') {
              void session.show(chosen)
            }
          }}
        >
          <ToggleGroupItem
            value="open"
            className="rounded-sm! px-2.5 hover:bg-transparent data-pressed:bg-background data-pressed:text-foreground data-pressed:shadow-sm"
          >
            Open
          </ToggleGroupItem>
          <ToggleGroupItem
            value="completed"
            className="rounded-sm! px-2.5 hover:bg-transparent data-pressed:bg-background data-pressed:text-foreground data-pressed:shadow-sm"
          >
            Completed
          </ToggleGroupItem>
        </ToggleGroup>

        {/* One of the Task Entry Points, and it reaches the very same resident
            window the Hotkey and the Tray Menu do — never a second creation
            surface inside this one. */}
        <Button
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={() => void desktop.beginTaskCreation()}
        >
          <PlusIcon />
          New Task
        </Button>
      </header>

      {problem !== null && (
        <p role="alert" className="shrink-0 px-6 pb-3 type-meta text-destructive">
          {problem}
        </p>
      )}

      <main className="flex-1 overflow-y-auto px-6 pb-5">
        {tasks.state === 'unreadable' && (
          <EmptyState
            icon={TriangleAlertIcon}
            heading="The Tasks could not be read."
          />
        )}
        {tasks.state === 'tasks' && list.length === 0 && showing === 'open' && (
          <NoOpenTasks hotkeys={hotkeys} />
        )}
        {tasks.state === 'tasks' &&
          list.length === 0 &&
          showing === 'completed' && (
            <EmptyState
              icon={CheckCircle2Icon}
              heading="No Completed Tasks yet"
            />
          )}
        {list.length > 0 && (
          <ol className="flex flex-col gap-1">
            {list.map((task) => (
              <TaskLine
                key={task.id}
                task={task}
                onToggle={(done) =>
                  void (done ? session.complete(task.id) : session.reopen(task.id))
                }
                onEdit={() => setEditing(task)}
                onDelete={() => setDeleting(task)}
              />
            ))}
          </ol>
        )}
      </main>

      {editing !== null && (
        <TaskEditor
          task={editing}
          onSave={(description) => commitEdit(editing, description)}
          onCancel={() => setEditing(null)}
        />
      )}

      <ConfirmDelete
        task={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  )
}

/**
 * One Task as it reads now: the checkbox that completes it, what it says, and
 * the way to remove it. Pressing the description opens the Editor — a Task is
 * one line, and changing it is a decision rather than a place to put a cursor.
 *
 * The checkbox completes immediately and asks nothing: completing is reversible
 * from the row beside it, and a confirmation on the most ordinary action in the
 * app would be in the way every single time.
 */
function TaskLine({
  task,
  onToggle,
  onEdit,
  onDelete,
}: {
  task: Task
  onToggle: (completed: boolean) => void
  onEdit: () => void
  onDelete: () => void
}) {
  const done = task.completedAt !== null

  return (
    <li className="group flex items-start gap-3 rounded-md py-1.5 pl-2 pr-1 type-body hover:bg-muted/40 focus-within:bg-muted/40">
      <span className="pt-1">
        <Checkbox
          checked={done}
          onCheckedChange={onToggle}
          aria-label={
            done ? `Reopen “${task.description}”` : `Complete “${task.description}”`
          }
        />
      </span>

      <button
        type="button"
        onClick={onEdit}
        className={`min-w-0 flex-1 cursor-text rounded-sm py-0.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/30 ${
          done ? 'text-muted-foreground line-through' : ''
        }`}
      >
        {task.description}
      </button>

      {task.completedAt !== null && (
        <time
          dateTime={task.completedAt}
          className="shrink-0 pt-1 tabular-nums type-meta text-muted-foreground"
        >
          {formatTaskCompletedAt(task.completedAt)}
        </time>
      )}

      <div className="flex shrink-0 items-center gap-0.5 pointer-events-none opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onDelete}
          aria-label={`Delete “${task.description}”`}
          className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2Icon />
        </Button>
      </div>
    </li>
  )
}

/**
 * The sheet that changes an existing Task. Save commits; Cancel, Escape and
 * closing all discard. It is inside this window rather than the resident Task
 * Creation one on purpose: reusing that window would throw away an unfinished
 * new Task to edit an old one.
 */
function TaskEditor({
  task,
  onSave,
  onCancel,
}: {
  task: Task
  onSave: (description: string) => void
  onCancel: () => void
}) {
  const [description, setDescription] = useState(task.description)
  const headingId = useId()
  const said = description.trim()

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' && said !== '') {
      event.preventDefault()
      onSave(description)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={headingId}
      className="absolute inset-x-0 bottom-0 z-20 flex flex-col gap-3 border-t border-border bg-popover px-6 py-4 shadow-[0_-8px_24px_-12px_rgb(0_0_0/0.4)]"
    >
      <h2 id={headingId} className="type-section">
        Edit Task
      </h2>
      <input
        autoFocus
        type="text"
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        onKeyDown={onKeyDown}
        aria-label="Task Description"
        autoComplete="off"
        spellCheck={false}
        className="w-full rounded-md border border-border bg-transparent px-2 py-1.5 type-body text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
      />
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={said === ''}
          onClick={() => onSave(description)}
        >
          Save
        </Button>
      </div>
    </div>
  )
}

/**
 * The guard on the one irreversible operation. There is no trash and no undo,
 * so the confirmation says plainly that this is permanent.
 */
function ConfirmDelete({
  task,
  onConfirm,
  onCancel,
}: {
  task: Task | null
  onConfirm: (task: Task) => void
  onCancel: () => void
}) {
  return (
    <AlertDialog
      open={task !== null}
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this Task?</AlertDialogTitle>
          <AlertDialogDescription>
            “{task?.description}” will be gone for good. There is no trash and no
            undo.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => task !== null && onConfirm(task)}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/**
 * Nothing owed yet, and the fastest way to owe something. The Tray Menu is the
 * fallback, and is all this says when the Task Hotkey is unavailable or
 * unknown: an empty state that taught a combination doing nothing would be
 * worse than the slow way in.
 */
function NoOpenTasks({ hotkeys }: { hotkeys: HotkeyStatuses | null }) {
  const task = hotkeys?.task

  return (
    <EmptyState icon={ListTodoIcon} heading="No Open Tasks">
      {task?.state === 'registered' ? (
        <>
          Press{' '}
          <KbdGroup className="align-baseline">
            {keysOfHotkey(task.hotkey).map((key) => (
              <Kbd key={key}>{key}</Kbd>
            ))}
          </KbdGroup>
          , type one line about what you need to do, and press Enter. New Task in
          the Work Journal menu does the same thing.
        </>
      ) : (
        <>
          Choose New Task from the Work Journal menu, type one line about what
          you need to do, and press Enter.
        </>
      )}
    </EmptyState>
  )
}

/**
 * A list that is not there, and why. The icon and the heading are what make it
 * read as an answer rather than as a page still loading.
 */
function EmptyState({
  icon: Icon,
  heading,
  children,
}: {
  icon: LucideIcon
  heading: string
  children?: React.ReactNode
}) {
  const headingId = useId()

  return (
    <section
      aria-labelledby={headingId}
      className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center type-body"
    >
      <span
        aria-hidden
        className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground"
      >
        <Icon className="size-5" />
      </span>
      <h2 id={headingId} className="type-section text-foreground">
        {heading}
      </h2>
      {children !== undefined && (
        <p className="max-w-sm text-muted-foreground">{children}</p>
      )}
    </section>
  )
}
