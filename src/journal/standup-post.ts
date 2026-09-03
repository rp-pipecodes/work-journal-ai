/**
 * The records a Standup Post would be written from, and the one thing a model
 * call is sent.
 *
 * This is deliberately separate from the Journal core: the core already knows
 * how to read Notes and Tasks, while this cross-cuts its retrospective and
 * prospective axes. It is selection, not another SQL query — see
 * `CONTEXT.md` and docs/adr/0027-the-standup-post-never-replaces-yesterdays-digest.md.
 */

import {
  formatSlot,
  groupOpenTasks,
  journalDayFor,
  rangeForPreset,
  scheduleOf,
  slotOf,
  type Clock,
  type CompletedOccurrence,
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
  /**
   * Task Occurrences completed yesterday, newest completion first, each with
   * the Recurring Task it belongs to. The parent is never completed by this —
   * it continues, and appears among today's Open Tasks.
   */
  completedOccurrences: CompletedOccurrence[]
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
  const [notes, completedTasks, completedOccurrences, openTasks] =
    await Promise.all([
      journal.notesForFilter({ from: yesterday, to: yesterday }),
      journal.completedTasks(),
      journal.occurrencesKeptIn({ from: yesterday, to: yesterday }),
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
    completedOccurrences,
    openTasks: openTodayOrOverdue,
  }
}

/**
 * Whether a Generate would refuse without spending a call. The two halves are
 * yesterday — Notes, Tasks completed yesterday, and Task Occurrences kept
 * yesterday — and today's Open Tasks that stand on their own; only a day
 * with neither half is nothing to say. A kept recurring commitment is real
 * work, so a day whose only content is a completed occurrence is not refused:
 * which unblocks a billable Generate on days that are refused for free
 * without it.
 */
export function standupPostRefuses(selection: StandupPostSelection): boolean {
  return (
    selection.notes.length === 0 &&
    selection.completedTasks.length === 0 &&
    selection.completedOccurrences.length === 0 &&
    selection.openTasks.length === 0
  )
}

/**
 * What the model hears, built from the selection already on screen: the
 * Digest of yesterday, verbatim — `#project` prefixes and all — plus a plain
 * Markdown list of the Tasks. No second serialisation: a second format would
 * eventually describe a journal the user does not have.
 *
 * The Notes half is literally the journal's own Digest for yesterday — the
 * same rendering History copies — so the two formats cannot drift apart; the
 * Task lists are the selection's own Tasks, each as one bullet. A section
 * with nothing in it is left out entirely, so a day of Tasks alone sends no
 * empty Notes heading, and vice versa.
 */
export async function buildStandupPostInput({
  journal,
  selection,
}: {
  journal: Journal
  selection: StandupPostSelection
}): Promise<string> {
  const digest = await journal.digest({
    from: selection.yesterday,
    to: selection.yesterday,
  })

  const parts: string[] = []
  if (digest.markdown !== '') parts.push(digest.markdown)
  if (
    selection.completedTasks.length > 0 ||
    selection.completedOccurrences.length > 0
  ) {
    // Work kept yesterday is one set, so the section reads newest completion
    // first across both record types. Completed At is non-null on both sides
    // by construction — `selectStandupPost` filters the Tasks, and the range
    // read's query asks for completed occurrences only — so the fallback
    // never fires and is spelled as the absence it is.
    const bullets = [
      ...selection.completedOccurrences.map((completed) => ({
        completedAt: completed.occurrence.completedAt ?? '',
        bullet: occurrenceBullet(completed),
      })),
      ...selection.completedTasks.map((task) => ({
        completedAt: task.completedAt ?? '',
        bullet: taskBullet(task),
      })),
    ].sort((one, other) => (one.completedAt < other.completedAt ? 1 : -1))
      .map((one) => one.bullet)
    parts.push(`## Completed yesterday\n${bullets.join('\n')}`)
  }
  if (selection.openTasks.length > 0) {
    parts.push(
      `## Still to do\n${selection.openTasks
        .map((task) => taskBullet(task))
        .join('\n')}`,
    )
  }

  return parts.join('\n\n')
}

/**
 * One Task as the model hears it: the checkbox saying which state it is in,
 * the description as written, and — when there is one — its Scheduled For,
 * the same way an export spells it. Absent metadata is omitted, so a line
 * says nothing the journal does not know.
 */
function taskBullet(task: Task): string {
  const schedule = scheduleOf(task)
  const said = schedule !== null ? ` (scheduled ${formatSlot(schedule)})` : ''
  const box = task.completedAt === null ? ' ' : 'x'
  return `- [${box}] ${task.description}${said}`
}

/**
 * One kept Task Occurrence as the model hears it: always checked, because
 * the record is a completion — the checkbox is the occurrence's, never the
 * parent Task's, which carries on and is rendered only under Still to do.
 * The Task Description comes from the parent riding along in the selection,
 * and the slot is spelled the one way the app spells one, the word
 * `occurrence` matching Export and the glossary.
 */
function occurrenceBullet(completed: CompletedOccurrence): string {
  return `- [x] ${completed.task.description} (occurrence ${formatSlot(
    slotOf(completed.occurrence),
  )})`
}
