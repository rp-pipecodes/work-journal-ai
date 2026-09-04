/**
 * The work kept as Markdown bullets, shared by the lossless renderings that
 * name it — Standup Material and Review Material. Extracted from
 * `standup-post.ts` rather than copied, so the two can never disagree about
 * what one kept commitment reads as.
 *
 * A Task and a Task Occurrence are different records that read as one set of
 * work kept, so the merge sorts both by completion instant. Ordering is
 * deterministic: by completion instant, with a stable ID tie-break so two
 * completions at the same instant read the same way every time.
 */

import {
  formatSlot,
  journalDayFor,
  scheduleOf,
  slotOf,
  type CompletedOccurrence,
  type Task,
} from './journal'

/**
 * One kept commitment as a bullet, ready to render: when it was kept, which
 * Journal Day that falls under, and the Markdown line itself.
 */
export interface CompletionBullet {
  /** UTC ISO-8601 instant the Task or occurrence was completed. */
  completedAt: string
  /** Stable tie-break: the Task ID, or the occurrence ID. */
  id: string
  /** The local Journal Day the completion falls under. */
  journalDay: string
  /** One Markdown bullet, as `taskBullet` or `occurrenceBullet` reads it. */
  bullet: string
}

/**
 * One Task as the model hears it: the checkbox saying which state it is in,
 * the description as written, and — when there is one — its Scheduled For,
 * the same way an export spells it. Absent metadata is omitted, so a line
 * says nothing the journal does not know.
 */
export function taskBullet(task: Task): string {
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
export function occurrenceBullet(completed: CompletedOccurrence): string {
  return `- [x] ${completed.task.description} (occurrence ${formatSlot(
    slotOf(completed.occurrence),
  )})`
}

/**
 * Both record types as one set of work kept. Completed At is non-null on both
 * sides by construction — selections filter the Tasks, and the range read's
 * query asks for completed occurrences only — so the fallback never fires and
 * is spelled as the absence it is.
 */
export function mergeCompletions({
  completedTasks,
  completedOccurrences,
  order,
}: {
  completedTasks: Task[]
  completedOccurrences: CompletedOccurrence[]
  order: 'oldest-first' | 'newest-first'
}): CompletionBullet[] {
  const merged: CompletionBullet[] = [
    ...completedOccurrences.map((completed) => ({
      completedAt: completed.occurrence.completedAt ?? '',
      id: completed.occurrence.id,
      journalDay: journalDayFor(
        new Date(completed.occurrence.completedAt ?? 0),
      ),
      bullet: occurrenceBullet(completed),
    })),
    ...completedTasks.map((task) => ({
      completedAt: task.completedAt ?? '',
      id: task.id,
      journalDay: journalDayFor(new Date(task.completedAt ?? 0)),
      bullet: taskBullet(task),
    })),
  ]

  merged.sort((one, other) => {
    if (one.completedAt !== other.completedAt) {
      const oldestFirst =
        one.completedAt < other.completedAt ? -1 : 1
      return order === 'oldest-first' ? oldestFirst : -oldestFirst
    }
    if (one.id === other.id) return 0
    const idFirst = one.id < other.id ? -1 : 1
    return order === 'oldest-first' ? idFirst : -idFirst
  })

  return merged
}

/**
 * The one day each kept commitment falls under, oldest day first, bullets in
 * the order they arrived. Days with no completions are simply absent.
 */
export interface CompletionDayGroup {
  journalDay: string
  bullets: string[]
}

export function groupCompletionsByDay(
  completions: CompletionBullet[],
): CompletionDayGroup[] {
  const groups: CompletionDayGroup[] = []

  for (const completion of completions) {
    const open = groups.at(-1)
    if (open?.journalDay === completion.journalDay) {
      open.bullets.push(completion.bullet)
    } else {
      groups.push({
        journalDay: completion.journalDay,
        bullets: [completion.bullet],
      })
    }
  }

  return groups
}
