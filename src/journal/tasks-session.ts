/**
 * Managing what you owe, as a session rather than a screen: which of the two
 * lists is showing, the Tasks it resolves to, which of the four groups each one
 * falls in, and what a change to any of them re-reads. Every sequencing rule of
 * Tasks View lives here — which of two overlapping reads may reach the view,
 * what a refused change says, when the OS is asked to allow Task Alerts — so
 * the tasks window is JSX over a snapshot.
 *
 * Headless on purpose: it is built from a Journal, a Desktop and a clock, and
 * nothing else, so the rules can be driven end to end from a test with real SQL
 * and no DOM. It holds no domain rule of its own — grouping, ordering and which
 * Tasks have an Alert all stay in the core, which this module asks.
 *
 * A session is built per tasks window and is never reset: the window is created
 * on demand and genuinely closed on dismiss.
 */

import type { Desktop } from '@/platform/desktop'
import { ALERT_REFUSED, askAboutTaskAlerts } from './task-alerts'
import {
  groupOpenTasks,
  isOpen,
  type Clock,
  type Journal,
  type Task,
  type TaskGroup,
  type TaskSchedule,
} from './journal'

/**
 * Which list is showing. Open is where Tasks View opens, because a Task is
 * about what remains; Completed is a separate view rather than a filter over
 * the same one, and there is nothing else to choose between.
 */
export type TasksTab = 'open' | 'completed'

/**
 * What Tasks View has to show, once the core has been asked. The Open list
 * carries its groups with it — the same Tasks, in the same order, said in the
 * four groups the window opens on. The Completed list has none: it is one list,
 * newest kept first.
 */
export type TasksState =
  | { state: 'loading' }
  | { state: 'tasks'; tasks: Task[]; groups: TaskGroup[] }
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
  /**
   * What macOS said about Task Alerts the last time it was asked in context —
   * nothing until a Task with a time has been saved. A denial is worth saying
   * once, where the user just asked for the Alert; Settings is where it stays
   * sayable afterwards.
   */
  alertRefusal: string | null
}

/** Where every session starts: nothing asked yet, so nothing to show. */
export const openingTasksSnapshot: TasksSnapshot = {
  showing: 'open',
  tasks: { state: 'loading' },
  problem: null,
  alertRefusal: null,
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
  /**
   * The Tasks are what they were, but the day has moved: local midnight, a
   * wake, or the window being looked at again. Re-groups what is already here,
   * without asking the database a question whose answer has not changed.
   */
  regroup(): void
  /**
   * One save from the Task Editor: the wording and the schedule together,
   * because the Editor commits both at once and a save that half landed would
   * leave the user unable to say which half.
   *
   * Saving a Task with a time is where the OS is asked to allow Task Alerts,
   * and only the first time — in context, never at launch. Whatever the answer,
   * the Task is saved: the record is authoritative and the Alert is derived
   * from it.
   */
  save(
    id: string,
    change: { description: string; schedule: TaskSchedule | null },
  ): Promise<void>
  complete(id: string): Promise<void>
  reopen(id: string): Promise<void>
  delete(id: string): Promise<void>
}

export function createTasksSession({
  journal,
  desktop,
  clock,
  onChange,
}: {
  /**
   * Handed in rather than imported, so a test can drive a real one. Awaited
   * rather than held: the app's journal opens a database before it exists, and
   * a session is built while that is still in flight.
   */
  journal: Promise<Journal>
  /**
   * Every change that lands is announced through it, so that no other Task
   * surface in the app — a second window, the Task Creation window, the
   * reconciliation that keeps macOS's pending Alerts true — is left on a list
   * that stopped being true. A change the record refused announces nothing:
   * nothing changed.
   */
  desktop: Desktop
  clock: Clock
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
      show({
        tasks: {
          state: 'tasks',
          tasks,
          groups: tab === 'open' ? groupOpenTasks(tasks, clock.now()) : [],
        },
      })
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
  ): Promise<boolean> {
    let problem: string | null = null
    try {
      const core = await journal
      await make(core)
      await announce()
    } catch (error) {
      console.error('could not change the Task', error)
      problem = refusal
    }
    // Said whether or not it changed: a change that worked clears the one
    // before it, so no problem outlives the list it was about.
    show({ problem })
    await read(snapshot.showing)

    return problem === null
  }

  /**
   * A change that landed, said to every other Task surface. Never worth
   * failing a change over: the Task is already stored, and a window that did
   * not hear is a window one refresh behind.
   */
  async function announce(): Promise<void> {
    try {
      await desktop.announceTasksChanged()
    } catch (error) {
      console.error('could not announce the Task', error)
    }
  }

  /**
   * Asks the OS about Task Alerts, in context, and says so where the user just
   * asked for one. The rule about when to ask is shared with the Task Creation
   * window; all that belongs here is what the answer puts on screen.
   */
  async function askAboutAlerts(): Promise<void> {
    const answer = await askAboutTaskAlerts(desktop)
    // An OS that would not say what it allows is not something to accuse of
    // refusing: nothing is said, and Settings still reports the truth.
    if (answer !== 'unknown') {
      show({ alertRefusal: answer === 'refused' ? ALERT_REFUSED : null })
    }
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

    regroup() {
      const { tasks } = snapshot
      if (tasks.state !== 'tasks' || snapshot.showing !== 'open') return

      show({
        tasks: {
          ...tasks,
          groups: groupOpenTasks(tasks.tasks, clock.now()),
        },
      })
    },

    async save(id, { description, schedule }) {
      let timed = false

      const saved = await change(
        'That Task could not be saved.',
        async (core) => {
          const task = await core.editTask(id, { description, schedule })
          // Only an Open Task can have gained a time: a Completed one keeps
          // the schedule it was completed with, and asking macOS about an
          // Alert for a commitment already kept would make no sense.
          timed = isOpen(task) && schedule !== null && schedule.time !== null
        },
      )

      if (saved && timed) await askAboutAlerts()
    },

    async complete(id) {
      await change('That Task could not be completed.', (core) =>
        core.completeTask(id),
      )
    },
    async reopen(id) {
      await change('That Task could not be reopened.', (core) =>
        core.reopenTask(id),
      )
    },
    async delete(id) {
      await change('That Task could not be deleted.', (core) =>
        core.deleteTask(id),
      )
    },
  }
}
