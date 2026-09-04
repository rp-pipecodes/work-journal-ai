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
  groupOpenTasks,
  journalDayFor,
  rangeForPreset,
  type Clock,
  type CompletedOccurrence,
  type Journal,
  type Note,
  type Task,
} from './journal'
import { mergeCompletions, taskBullet } from './completions'

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
 * Standup Material: the complete, lossless Markdown of yesterday, built from
 * the selection already on screen — the Digest of yesterday, verbatim —
 * `#project` prefixes and all — plus a plain Markdown list of the Tasks. It
 * is what a Standup Post is written from, and what the user pastes instead
 * when there is no Model Access, the endpoint is down, or the prose came
 * back wrong. See `CONTEXT.md` and
 * docs/adr/0031-standup-material-is-a-second-lossless-rendering.md.
 *
 * No second serialisation: a second format would eventually describe a
 * journal the user does not have.
 *
 * The Notes half is literally the journal's own Digest for yesterday — the
 * same rendering History copies — so the two formats cannot drift apart; the
 * Task lists are the selection's own Tasks, each as one bullet. A section
 * with nothing in it is left out entirely, so a day of Tasks alone carries
 * no empty Notes heading, and vice versa.
 */
export async function buildStandupMaterial({
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
    // first across both record types — see `mergeCompletions`.
    const bullets = mergeCompletions({
      completedTasks: selection.completedTasks,
      completedOccurrences: selection.completedOccurrences,
      order: 'newest-first',
    }).map((one) => one.bullet)
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
