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

/**
 * Whether a Generate would refuse without spending a call. The two halves are
 * yesterday — Notes and Tasks completed yesterday — and today's Open Tasks
 * that stand on their own; only a day with neither half is nothing to say.
 */
export function standupPostRefuses(selection: StandupPostSelection): boolean {
  return (
    selection.notes.length === 0 &&
    selection.completedTasks.length === 0 &&
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
  if (selection.completedTasks.length > 0) {
    parts.push(
      `## Completed yesterday\n${selection.completedTasks
        .map((task) => taskBullet(task))
        .join('\n')}`,
    )
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
 * The system prompt a Standup Post is written under, as shipped. Hardcoded
 * here and read by the view until the Standup Prompt setting makes it the
 * user's — see issue #133. Written blind of the actual chat group, so it
 * states the four assumptions #56 settled on: two labelled sections, `#project`
 * names kept, first person, nothing stated that is absent from the input,
 * and the input's language.
 */
export const DEFAULT_STANDUP_PROMPT = `You are writing a standup post for the user to paste into a chat group.

Write in the first person, as the user would, in the same language as the input.

Structure the post in two labelled sections: what was done yesterday, and what is planned or still to do today.

Keep #project names exactly as they appear in the input.

Say only what the input supports: state nothing that is not in it.

Keep it brief and natural, ready to paste.`
