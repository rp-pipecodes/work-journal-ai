/**
 * Managing what you owe, as a session rather than a screen: which of the two
 * lists is showing, the Tasks it resolves to, and what a change to one of them
 * re-reads. Every sequencing rule of Tasks View lives here — which of two
 * overlapping reads may reach the view, what a refused change says — so the
 * tasks window is JSX over a snapshot.
 *
 * Headless on purpose: it is built from a Journal and one announcement, and
 * nothing else, so the rules can be driven end to end from a test with real SQL
 * and no DOM. It holds no domain rule of its own — those stay in the core,
 * which this module asks.
 *
 * A session is built per tasks window and is never reset: the window is created
 * on demand and genuinely closed on dismiss.
 */

import type { Journal, Task } from './journal'

/**
 * Which list is showing. Open is where Tasks View opens, because a Task is
 * about what remains; Completed is a separate view rather than a filter over
 * the same one, and there is nothing else to choose between.
 */
export type TasksTab = 'open' | 'completed'

/** What Tasks View has to show, once the core has been asked. */
export type TasksState =
  | { state: 'loading' }
  | { state: 'tasks'; tasks: Task[] }
  | { state: 'unreadable' }

/** Everything a tasks window renders, and the only thing it renders. */
export interface TasksSnapshot {
  showing: TasksTab
  tasks: TasksState
  /**
   * A change the record refused, said in the app's voice rather than the
   * error's. Nothing until one fails, and gone again the moment one succeeds —
   * a list that reads as the user asked claims nothing.
   */
  problem: string | null
}

/** Where every session starts: nothing asked yet, so nothing to show. */
export const openingTasksSnapshot: TasksSnapshot = {
  showing: 'open',
  tasks: { state: 'loading' },
  problem: null,
}

export interface TasksSession {
  /** What a view would render right now. */
  snapshot(): TasksSnapshot
  /** The first read: the Open Tasks, which is where Tasks View opens. */
  open(): Promise<void>
  /** The other list, or back again. Nothing else narrows either one. */
  show(tab: TasksTab): Promise<void>
  /**
   * The Tasks are no longer what they were, and not because of anything this
   * window did: one was created in the Task Creation window, or changed in
   * another Tasks View. Re-reads whichever list is showing.
   */
  refresh(): Promise<void>
  editDescription(id: string, description: string): Promise<void>
  complete(id: string): Promise<void>
  reopen(id: string): Promise<void>
  delete(id: string): Promise<void>
}

export function createTasksSession({
  journal,
  announceChange,
  onChange,
}: {
  /**
   * Handed in rather than imported, so a test can drive a real one. Awaited
   * rather than held: the app's journal opens a database before it exists, and
   * a session is built while that is still in flight.
   */
  journal: Promise<Journal>
  /**
   * Said after every change that landed, so every other Task surface in the
   * app — a second window, the Task Creation window — is not left on a list
   * that stopped being true. A change the record refused says nothing: nothing
   * changed.
   */
  announceChange: () => void
  onChange: (snapshot: TasksSnapshot) => void
}): TasksSession {
  let snapshot = openingTasksSnapshot
  // Reads can overlap — a completion while a tab change is still in flight —
  // and only the newest one may reach the view.
  let latestRead = 0

  function show(change: Partial<TasksSnapshot>): void {
    snapshot = { ...snapshot, ...change }
    onChange(snapshot)
  }

  /** Better than a window that never stops loading, and never a stale read. */
  function giveUp(error: unknown, ticket: number): void {
    console.error('could not read the Tasks', error)
    if (latestRead === ticket) show({ tasks: { state: 'unreadable' } })
  }

  /**
   * One list, asked of the core. The list on screen is never patched in place:
   * completing a Task moves it out of the Open list entirely, so what a change
   * leaves behind is a question for the record rather than for the array.
   */
  async function read(tab: TasksTab): Promise<void> {
    const ticket = ++latestRead
    try {
      const core = await journal
      const tasks =
        tab === 'open' ? await core.openTasks() : await core.completedTasks()
      if (latestRead !== ticket) return
      show({ tasks: { state: 'tasks', tasks } })
    } catch (error) {
      giveUp(error, ticket)
    }
  }

  /**
   * One change to the record, then the list as it now reads. A refused change
   * leaves a list that looks exactly as it would if the user had never asked,
   * so it has to say so: `refusal` is what did not happen, in the app's voice
   * rather than the error's.
   */
  async function change(
    refusal: string,
    make: (core: Journal) => Promise<unknown>,
  ): Promise<void> {
    let problem: string | null = null
    try {
      const core = await journal
      await make(core)
      announceChange()
    } catch (error) {
      console.error('could not change the Task', error)
      problem = refusal
    }
    // Said whether or not it changed: a change that worked clears the one
    // before it, so no problem outlives the list it was about.
    show({ problem })
    await read(snapshot.showing)
  }

  return {
    snapshot: () => snapshot,

    open: () => read('open'),

    async show(tab) {
      // A problem is about the list it was raised over, and this is a
      // different one.
      show({ showing: tab, problem: null })
      await read(tab)
    },

    refresh: () => read(snapshot.showing),

    editDescription: (id, description) =>
      change('That Task could not be reworded.', (core) =>
        core.editTaskDescription(id, description),
      ),
    complete: (id) =>
      change('That Task could not be completed.', (core) =>
        core.completeTask(id),
      ),
    reopen: (id) =>
      change('That Task could not be reopened.', (core) => core.reopenTask(id)),
    delete: (id) =>
      change('That Task could not be deleted.', (core) => core.deleteTask(id)),
  }
}
