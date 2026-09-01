/**
 * The records a Standup Post would be written from.
 *
 * This is deliberately separate from the Journal core: the core already knows
 * how to read Notes and Tasks, while this cross-cuts its retrospective and
 * prospective axes. It is selection, not another SQL query — see
 * `CONTEXT.md` and docs/adr/0027-the-standup-post-never-replaces-yesterdays-digest.md.
 */

import {
  groupOpenTasks,
  journalDayFor,
  rangeForPreset,
  type Clock,
  type Journal,
  type Note,
  type Task,
} from './journal'

export interface StandupPostSelection {
  /** The previous calendar day this material is about. */
  yesterday: string
  /** Every Note filed under yesterday, including Imported Notes. */
  notes: Note[]
  /** Ordinary Tasks completed yesterday, newest completion first. */
  completedTasks: Task[]
  /** Open Tasks that are Overdue or scheduled for today. */
  openTasks: Task[]
}

/**
 * Selects the complete input for a Standup Post without changing History's
 * Filter. The clock is read at request time, so a Main Window left open over
 * midnight describes the previous calendar day when it is next refreshed.
 */
export async function selectStandupPost({
  journal,
  clock,
}: {
  journal: Journal
  clock: Clock
}): Promise<StandupPostSelection> {
  const now = clock.now()
  const yesterday = rangeForPreset('yesterday', journalDayFor(now)).from
  const [notes, completedTasks, openTasks] = await Promise.all([
    journal.notesForFilter({ from: yesterday, to: yesterday }),
    journal.completedTasks(),
    journal.openTasks(),
  ])

  const completedYesterday = completedTasks.filter(
    (task) =>
      task.completedAt !== null &&
      journalDayFor(new Date(task.completedAt)) === yesterday,
  )
  const openTodayOrOverdue = groupOpenTasks(openTasks, now)
    .filter((group) => group.name === 'overdue' || group.name === 'today')
    .flatMap((group) => group.tasks)

  return {
    yesterday,
    notes,
    completedTasks: completedYesterday,
    openTasks: openTodayOrOverdue,
  }
}
