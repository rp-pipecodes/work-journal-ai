/**
 * The records a Work Summary is written from, and the one thing a model call
 * is sent.
 *
 * This is deliberately separate from the Journal core: the core already knows
 * how to read Notes and Tasks, while this cross-cuts its retrospective and
 * prospective axes. It is selection, not another SQL query — see
 * `CONTEXT.md` and docs/adr/0041-work-summary-combines-a-selected-period-with-current-commitments.md.
 */

import {
  dayInRange,
  formatDayRange,
  journalDayFor,
  type CompletedOccurrence,
  type DayRange,
  type Journal,
  type Note,
  type Task,
} from './journal'
import {
  mergeCompletions,
  renderCompletedSection,
  taskBullet,
} from './completions'

export interface WorkSummarySelection {
  /** The first Journal Day of the selected range, inclusive. */
  from: string
  /** The last Journal Day of the selected range, inclusive. */
  to: string
  /** Every Note filed in the range, including Imported Notes. */
  notes: Note[]
  /** Ordinary Tasks completed in the range, oldest completion first. */
  completedTasks: Task[]
  /**
   * Task Occurrences completed in the range, oldest completion first, each
   * with the Recurring Task it belongs to. The parent is never completed by
   * this — it continues, and appears among the current Open Tasks.
   */
  completedOccurrences: CompletedOccurrence[]
  /**
   * Every currently Open Task — overdue, today, future, and Unscheduled —
   * independently of the selected range. Current commitments, not history:
   * nothing here claims they were open during the range.
   */
  openTasks: Task[]
}

/**
 * Selects the complete input for a Work Summary: the settled range's Notes
 * and completions, plus every currently Open Task. The range arrives settled
 * — the This-week preset, Monday through today, fixed by the view when the
 * Main Window opens — so a window left open over midnight keeps describing
 * the week it opened in. Selection never touches History's Filter and needs
 * no Occupied Day: a week of Tasks alone selects fine.
 */
export async function selectWorkSummary({
  journal,
  range: { from, to },
}: {
  journal: Journal
  range: DayRange
}): Promise<WorkSummarySelection> {
  const [notes, completedTasks, completedOccurrences, openTasks] =
    await Promise.all([
      journal.notesForFilter({ from, to }),
      journal.completedTasks(),
      journal.occurrencesKeptIn({ from, to }),
      journal.openTasks(),
    ])

  return {
    from,
    to,
    notes,
    completedTasks: completedTasks.filter(
      (task) =>
        task.completedAt !== null &&
        dayInRange(journalDayFor(new Date(task.completedAt)), from, to),
    ),
    completedOccurrences: completedOccurrences.filter(
      (completed) =>
        completed.occurrence.completedAt !== null &&
        dayInRange(
          journalDayFor(new Date(completed.occurrence.completedAt)),
          from,
          to,
        ),
    ),
    openTasks,
  }
}

/**
 * Whether a Generate would refuse without spending a call. The two halves are
 * the selected period — Notes, Tasks completed in it, and Task Occurrences
 * kept in it — and the current Open Tasks that stand on their own; only a
 * week with neither half is nothing to say. A kept recurring commitment is
 * real work, so a week whose only accomplishment is a completed occurrence is
 * not refused.
 */
export function workSummaryRefuses(selection: WorkSummarySelection): boolean {
  return (
    selection.notes.length === 0 &&
    selection.completedTasks.length === 0 &&
    selection.completedOccurrences.length === 0 &&
    selection.openTasks.length === 0
  )
}

/**
 * Work Summary Material: the complete, lossless Markdown of the selected
 * range, built from the selection already on screen — the range's Digest
 * verbatim, `#project` prefixes and all, plus the work completed in it
 * oldest-first — followed by every currently Open Task explicitly identified
 * as current. It is what a Work Summary is written from, and what the user
 * pastes instead when there is no Model Access, the endpoint is down, or the
 * prose came back wrong. See `CONTEXT.md` and
 * docs/adr/0041-work-summary-combines-a-selected-period-with-current-commitments.md.
 *
 * No second serialisation: a second format would eventually describe a
 * journal the user does not have.
 *
 * A section with nothing in it is left out entirely, so a week of
 * commitments alone carries no empty accomplishments heading, and vice versa.
 * A week with neither half reads as the clear empty result the section
 * refuses to send or copy.
 */
export async function buildWorkSummaryMaterial({
  journal,
  selection,
}: {
  journal: Journal
  selection: WorkSummarySelection
}): Promise<string> {
  const digest = await journal.digest({
    from: selection.from,
    to: selection.to,
  })
  const completions = mergeCompletions({
    completedTasks: selection.completedTasks,
    completedOccurrences: selection.completedOccurrences,
    order: 'oldest-first',
  })

  if (
    digest.markdown === '' &&
    completions.length === 0 &&
    selection.openTasks.length === 0
  ) {
    return ''
  }

  const parts: string[] = [`# ${formatDayRange(selection.from, selection.to)}`]
  if (digest.markdown !== '') parts.push(digest.markdown)
  if (completions.length > 0) {
    parts.push(renderCompletedSection(completions, selection.from !== selection.to))
  }
  if (selection.openTasks.length > 0) {
    parts.push(
      `## Currently open\n${selection.openTasks
        .map((task) => taskBullet(task))
        .join('\n')}`,
    )
  }

  return parts.join('\n\n')
}
