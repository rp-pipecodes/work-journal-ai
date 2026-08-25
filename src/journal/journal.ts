/**
 * The journal core: every domain operation and every SQL statement in the app.
 * It depends on exactly two injected collaborators — a clock and a SQL driver —
 * so it can be driven end to end from a test without Tauri, a webview, or a
 * real database. Views render what the core returns and call its operations in
 * response to input; no domain rule, formatting rule or SQL lives outside this
 * file.
 */

/** The instant a Note came into existence, and nothing else. */
export interface Clock {
  now(): Date
}

/** The machine's clock: the one the app runs on, wherever it needs one. */
export const systemClock: Clock = { now: () => new Date() }

/** The whole of the app's storage surface: a SQL string plus parameters. */
export interface SqlDriver {
  execute(sql: string, params: unknown[]): Promise<unknown>
  select<Row>(sql: string, params: unknown[]): Promise<Row[]>
}

/**
 * The two ways a Note comes into existence, and there is no third — see
 * docs/adr/0010-notes-have-two-origins.md. `capture` is the user typing one;
 * `import` is a meeting swept off their calendar without being asked.
 */
export type NoteOrigin = 'capture' | 'import'

export interface Note {
  id: string
  /** A single line, never empty or whitespace-only. */
  body: string
  /**
   * Optional Project the Note is filed under. Null is Unfiled. Identity is
   * case-insensitive and stored lowercase.
   */
  project: string | null
  /** UTC ISO-8601. Provenance, not filing — never changes. */
  capturedAt: string
  /** `YYYY-MM-DD`. Decided at capture and never recomputed. */
  journalDay: string
  /** Null until the Note is changed after capture. */
  editedAt: string | null
  /**
   * Which of the two ways this Note came into existence. Ordinary in every
   * other respect: an Imported Note is edited, refiled and deleted like any
   * other, and only History renders it any differently.
   */
  origin: NoteOrigin
}

/**
 * A work commitment the user intends, or intended, to complete — a record
 * beside a Note rather than a kind of one: Notes recover work that happened,
 * Tasks hold work that remains or preserve that it was done. See
 * docs/adr/0014-tasks-are-first-class-work-commitments.md.
 *
 * A Task has no Project, no category and no relation to a Note. It is Open or
 * Completed, and editable in either state.
 */
export interface Task {
  id: string
  /**
   * The required single line that says what the Task is. Trimmed at the ends,
   * verbatim within — including whatever Unicode the user wrote, and including
   * words that look like a schedule, which nothing here interprets.
   */
  description: string
  /** UTC ISO-8601. The instant it came into existence, and never changes. */
  createdAt: string
  /**
   * When the commitment was completed, or null while it is Open. Reopening
   * clears it: that is the whole of what reopening is.
   */
  completedAt: string | null
}

/** Whether a Task is still a commitment, or a record that one was kept. */
export function isOpen(task: Task): boolean {
  return task.completedAt === null
}

/**
 * One event on the user's calendar, as the machine hands it over — see
 * `Desktop.todaysCalendarEvents`. Nothing here is a decision: which of these
 * become Notes is the core's, below.
 */
export interface CalendarEvent {
  /**
   * The event's identifier. Shared by every occurrence of a recurring event,
   * which is why it is not on its own the identity of a meeting.
   */
  id: string
  /** Which calendar it sits on — matched against the ticked ones. */
  calendarId: string
  /** The title, exactly as the calendar holds it. May be empty. */
  title: string
  /** Milliseconds since the epoch: a real instant, not a local label. */
  startsAt: number
  endsAt: number
  /** What the calendar itself says. Not the whole of the all-day rule. */
  isAllDay: boolean
  /** Whether the user's own attendance is Declined. */
  isDeclined: boolean
}

/**
 * The range of Journal Days currently being viewed, inclusive at both ends. A
 * single day is a range whose ends are equal. One of the Filter's two axes,
 * and the only one Presets, Search and Nudges ever move.
 */
export interface DayRange {
  /** `YYYY-MM-DD`, the oldest day in view. */
  from: string
  /** `YYYY-MM-DD`, the newest day in view. */
  to: string
}

/**
 * The Filter's other axis: one named Project, Unfiled, or no constraint at
 * all — see docs/adr/0008-project-narrows-filter.md.
 */
export type ProjectConstraint =
  | { kind: 'any' }
  | { kind: 'unfiled' }
  | { kind: 'named'; name: string }

/** No constraint: every Note in the day range, filed or not. */
export const ANY_PROJECT: ProjectConstraint = { kind: 'any' }

/** Only Notes with no Project — a real value, not the absence of one. */
export const UNFILED: ProjectConstraint = { kind: 'unfiled' }

/**
 * What is currently being viewed: a range of Journal Days and a Project
 * constraint. The two axes are independent and both must match for a Note to
 * appear. The constraint is optional in the type and absent means Any, so a
 * day range on its own is already a Filter.
 */
export interface Filter extends DayRange {
  project?: ProjectConstraint
}

/**
 * The Project axis of a Filter, whether or not it was written down: absent is
 * Any, so a bare day range narrows nothing.
 */
export function constraintOf(filter: Filter): ProjectConstraint {
  return filter.project ?? ANY_PROJECT
}

/**
 * A Filter rendered as Markdown, with the number of Notes that went into it —
 * the journal's only output, and the count the reader is told after copying so
 * they know it worked before they paste.
 */
export interface Digest {
  /** Plain Markdown: no app-specific formatting, nothing to clean up. */
  markdown: string
  /** Exactly the number of bullets in `markdown`. */
  noteCount: number
}

/**
 * The whole journal as one Markdown file, with what went into it. Notes and
 * Tasks are separate top-level sections, and both counts are reported: an
 * export of a journal holding only Tasks has to say so rather than read as an
 * export of nothing.
 */
export interface JournalExport {
  markdown: string
  noteCount: number
  taskCount: number
}

/** What a keystroke during a Capture means. */
export type KeystrokeDecision = 'commit' | 'discard' | 'ignore'

/**
 * What an open history window does about a Note captured while it is open.
 * Either the Note belongs in what is on screen, or the day it was filed under
 * is worth mentioning — never a Filter that moved on its own.
 */
export type ArrivalDecision =
  | { kind: 'show' }
  | { kind: 'nudge'; journalDay: string }

export interface Journal {
  /**
   * Commits one Note, or nothing at all — a Capture never ends in a partial or
   * empty Note. A leading Project Marker is consumed into Project + Body.
   * Returns null when there was nothing to commit.
   */
  capture(text: string): Promise<Note | null>
  /**
   * Turns one meeting into a Note, or does nothing because that meeting has
   * been handled before — including by an Import the user has since deleted,
   * which is a refusal and is permanent. Returns null in that case.
   *
   * The Note is Unfiled, its Body is the event's title and its Captured At is
   * the instant the meeting began, so a meeting swept up in the evening still
   * sorts into the morning it happened in. Whether an event should be here at
   * all is `meetingsToImport`'s question, not this one's.
   */
  importMeeting(event: CalendarEvent): Promise<Note | null>
  /**
   * Rewords a Note, so the journal reads correctly later. Captured At is
   * untouched — provenance survives every correction — and the Note is marked
   * as edited, so a reader knows the wording may not be the original. Wording
   * that has not actually changed is not an edit.
   */
  editBody(id: string, body: string): Promise<Note>
  /**
   * Files a Note under a different Journal Day, moving it between Filters.
   * Captured At is untouched: refiling says where a thought belongs, never
   * when it was had.
   */
  refile(id: string, journalDay: string): Promise<Note>
  /**
   * Files a Note under a different Project, or clears it to Unfiled. Captured
   * At, Body and Journal Day are untouched — Project is filing, not wording.
   * Null is Unfiled. A name is stored lowercase; the same Project is not an
   * edit.
   */
  editProject(id: string, project: string | null): Promise<Note>
  /**
   * Removes a Note permanently. There is no trash, no archive and no
   * `deleted_at` — the row is gone, and with it every Filter and Digest it
   * appeared in.
   */
  delete(id: string): Promise<void>
  /**
   * The days a reader starts from: the most recent Occupied Day, which is the
   * greatest Journal Day present and not yesterday's date — so a Monday
   * resolves to Friday when the weekend is empty, however long the gap. Null
   * when there are no Notes at all, rather than an arbitrary date. Only the
   * day axis: History opens on Any, which is nothing to decide.
   */
  defaultRange(): Promise<DayRange | null>
  /**
   * The Notes in a Filter, newest first — the order someone reading back at
   * standup wants, and the reverse of a Digest's. Both axes are predicates:
   * a Note has to fall in the day range and satisfy the Project constraint.
   */
  notesForFilter(filter: Filter): Promise<Note[]>
  /**
   * A Search: the Notes anywhere in the journal whose Body contains the term,
   * newest first like a Filter's list. It takes a term rather than a Filter
   * because a Search is a way of moving the Filter and never of narrowing it —
   * see docs/adr/0004-search-moves-the-filter-rather-than-narrowing-it.md.
   *
   * Matching is a case-insensitive substring of the Body and nothing more: the
   * whole term is one substring, and no other column is looked at. The known
   * limit is non-ASCII case folding, which SQLite's `LIKE` does not do —
   * `MIGRAÇÃO` does not match `migração`.
   */
  notesMatching(term: string): Promise<Note[]>
  /**
   * The Filter as Markdown to paste elsewhere. Oldest first — the reverse of
   * what the list shows, because scanning wants recency and narrative wants
   * chronology.
   *
   * Under a single named Project the bullets are Body only: the Project is
   * already what the whole Digest is about. Under Any or Unfiled a Note that
   * has a Project keeps a `#name` prefix, so a mixed paste still says which
   * stream each line came from.
   */
  digest(filter: Filter): Promise<Digest>
  /**
   * The whole journal as Markdown — the way out of the SQLite file, so nothing
   * kept here is locked in. Notes sit under a heading for each day and Tasks
   * under Open and Completed, as two top-level sections: they are separate
   * records, and a file that mixed them would say they are not.
   *
   * The Notes half is rendered exactly as a Digest is, but it is not one: a
   * Digest is bound to the Filter on screen and an export ignores the Filter
   * entirely. It is never about one Project, so a Note with one always keeps
   * its `#name` prefix.
   */
  exportJournal(): Promise<JournalExport>
  /**
   * Commits one Task. The description is trimmed at its ends and otherwise
   * kept verbatim; an empty one is refused rather than stored, because a Task
   * that says nothing is not a commitment. Duplicates are ordinary — two days
   * can owe the same thing — so nothing is checked against what is already
   * there.
   */
  createTask(description: string): Promise<Task>
  /**
   * The commitments that remain, newest first. In this slice every Open Task
   * is Unscheduled, so Task Created At is the whole of the order.
   */
  openTasks(): Promise<Task[]>
  /** The commitments that were kept, most recently completed first. */
  completedTasks(): Promise<Task[]>
  /**
   * Rewords a Task. Task Created At is untouched, and so is the state: a Task
   * remains editable whether it is Open or Completed.
   */
  editTaskDescription(id: string, description: string): Promise<Task>
  /**
   * Marks the commitment kept, recording when. Never asks first — completing
   * is reversible, and a confirmation on the most ordinary action in the app
   * would be in the way every single time.
   */
  completeTask(id: string): Promise<Task>
  /** Puts the commitment back: Task Completed At is removed, not kept. */
  reopenTask(id: string): Promise<Task>
  /**
   * Removes a Task permanently. There is no trash, no archive and no undo —
   * which is why this one is the only Task action that is confirmed.
   */
  deleteTask(id: string): Promise<void>
  /**
   * Project names currently on Notes, matched by case-insensitive prefix.
   * Distinct and sorted — there is no registry, so a name with no remaining
   * Notes is gone. What Capture offers as Predictions while the user types
   * after `#`.
   */
  projectPredictions(prefix: string): Promise<string[]>
  /**
   * Every Project currently on a Note, sorted. The same absence of a registry
   * as Predictions — a name with nothing left under it is gone — but a
   * different question: what History can narrow the Filter to, asked with no
   * prefix and nobody typing.
   */
  projectsInUse(): Promise<string[]>
  /**
   * How many Captured Notes are filed under one Journal Day — what the tray
   * glyph carries, and the only reminder the app ever gives that a day has
   * nothing said about it.
   *
   * Captured Notes only: a count inflated by meetings would reassure precisely
   * on the days nothing was typed — see
   * docs/adr/0010-notes-have-two-origins.md. Every Note there is today comes
   * from a Capture, so the day is the whole predicate; when Import lands, the
   * origin narrows it here.
   */
  capturedNoteCount(journalDay: string): Promise<number>
}

interface NoteRow {
  id: string
  body: string
  project: string | null
  captured_at: string
  journal_day: string
  edited_at: string | null
  origin: string
}

interface TaskRow {
  id: string
  description: string
  created_at: string
  completed_at: string | null
}

const INSERT_TASK = `
  INSERT INTO tasks (id, description, created_at, completed_at)
  VALUES (?, ?, ?, NULL)
`

/** Every read returns a whole Task; only the predicate and the order differ. */
const SELECT_TASKS = `
  SELECT id, description, created_at, completed_at
  FROM tasks
`

const SELECT_TASK = `
  ${SELECT_TASKS}
  WHERE id = ?
`

/** Newest commitment first: every Open Task here is Unscheduled. */
const SELECT_OPEN_TASKS = `
  ${SELECT_TASKS}
  WHERE completed_at IS NULL
  ORDER BY created_at DESC, id DESC
`

/** Most recently kept first — a different question, and a different order. */
const SELECT_COMPLETED_TASKS = `
  ${SELECT_TASKS}
  WHERE completed_at IS NOT NULL
  ORDER BY completed_at DESC, id DESC
`

/** Oldest first, both states together: the order an export reads in. */
const SELECT_ALL_TASKS_FOR_EXPORT = `
  ${SELECT_TASKS}
  ORDER BY created_at ASC, id ASC
`

/**
 * The description is the only changeable column. `created_at` is never in an
 * UPDATE anywhere in the app, and `completed_at` moves only through completing
 * and reopening — which are states, not edits.
 */
const UPDATE_TASK_DESCRIPTION = `
  UPDATE tasks SET description = ? WHERE id = ?
`

const UPDATE_TASK_COMPLETED_AT = `
  UPDATE tasks SET completed_at = ? WHERE id = ?
`

const DELETE_TASK = `
  DELETE FROM tasks WHERE id = ?
`

const INSERT_NOTE = `
  INSERT INTO notes (id, body, project, captured_at, journal_day, edited_at, origin)
  VALUES (?, ?, ?, ?, ?, NULL, ?)
`

/**
 * A meeting the sweep has handled. Written before the Note it becomes, and
 * never removed: the row outliving the Note is the whole point, since deleting
 * an Imported Note is how the user refuses its meeting for good.
 */
const INSERT_IMPORTED_MEETING = `
  INSERT INTO imported_meetings (event_key, handled_at)
  VALUES (?, ?)
`

/** Whether this occurrence has been swept before, whatever became of the Note. */
const SELECT_IMPORTED_MEETING = `
  SELECT event_key
  FROM imported_meetings
  WHERE event_key = ?
`

/** Every read returns a whole Note; only the predicate and the order differ. */
const SELECT_NOTES = `
  SELECT id, body, project, captured_at, journal_day, edited_at, origin
  FROM notes
`

const SELECT_NOTE = `
  ${SELECT_NOTES}
  WHERE id = ?
`

/**
 * Body, Journal Day and Project are the changeable columns, and each marks the
 * Note as edited; `captured_at` is never in an UPDATE anywhere in the app.
 */
const UPDATE_BODY = `
  UPDATE notes SET body = ?, edited_at = ? WHERE id = ?
`

const UPDATE_JOURNAL_DAY = `
  UPDATE notes SET journal_day = ?, edited_at = ? WHERE id = ?
`

const UPDATE_PROJECT = `
  UPDATE notes SET project = ?, edited_at = ? WHERE id = ?
`

const DELETE_NOTE = `
  DELETE FROM notes WHERE id = ?
`

const SELECT_MOST_RECENT_OCCUPIED_DAY = `
  SELECT journal_day
  FROM notes
  ORDER BY journal_day DESC
  LIMIT 1
`

/** Reverse chronological: the order a reader scanning back wants. */
const IN_LIST_ORDER = `ORDER BY journal_day DESC, captured_at DESC, id DESC`

/** Chronological: the order Markdown reads in, whatever is being rendered. */
const IN_DIGEST_ORDER = `ORDER BY journal_day ASC, captured_at ASC, id ASC`

/**
 * Both axes of a Filter as one read: the day range, the Project constraint,
 * and whichever order the caller reads in. The list and the Digest are the
 * same rows reversed, so they are the same predicate too.
 */
function selectNotesForFilter(filter: Filter, order: string): Query {
  const project = projectPredicate(filter)
  return {
    sql: `
      ${SELECT_NOTES}
      WHERE journal_day BETWEEN ? AND ?${project.sql}
      ${order}
    `,
    params: [filter.from, filter.to, ...project.params],
  }
}

/** A statement and the parameters that go with it, kept together. */
interface Query {
  sql: string
  params: unknown[]
}

/**
 * The Project axis as SQL. Any adds nothing at all — the Filter is then the
 * day range and nothing else — and the other two are a single predicate, so
 * both axes are one read rather than a list filtered afterwards.
 */
function projectPredicate(filter: Filter): Query {
  const constraint = constraintOf(filter)

  switch (constraint.kind) {
    case 'any':
      return { sql: '', params: [] }
    case 'unfiled':
      return { sql: ' AND project IS NULL', params: [] }
    case 'named':
      // Identity is case-insensitive and every Project is stored lowercase, so
      // a normalized name is an equality test — and a name that is not one at
      // all fails here rather than quietly matching nothing.
      return { sql: ' AND project = ?', params: [projectName(constraint.name)] }
  }
}

/**
 * The same order as a Filter's list, over the whole journal and predicated on
 * the Body instead. `LIKE` is case-insensitive for ASCII in SQLite, which is
 * the whole of the matching rule; the escape character is named so that a term
 * containing `%` or `_` reads as those characters rather than as a pattern.
 */
const SELECT_NOTES_MATCHING = `
  ${SELECT_NOTES}
  WHERE body LIKE ? ESCAPE '\\'
  ${IN_LIST_ORDER}
`

/** The same rows again with no predicate at all: the whole journal. */
const SELECT_ALL_NOTES_FOR_EXPORT = `
  ${SELECT_NOTES}
  ${IN_DIGEST_ORDER}
`

/**
 * The Captured Notes on one Journal Day, counted rather than read: the tray
 * wants a number, and a day's rows are not worth carrying across the seam to
 * take the length of.
 */
const COUNT_CAPTURED_NOTES_ON_DAY = `
  SELECT COUNT(*) AS count
  FROM notes
  WHERE journal_day = ?
    AND origin = 'capture'
`

/** Every Project still on a Note: the Filter's Project axis, enumerated. */
const SELECT_PROJECTS_IN_USE = `
  SELECT DISTINCT project
  FROM notes
  WHERE project IS NOT NULL
  ORDER BY project ASC
`

/**
 * Distinct Projects still on Notes. Prefix is matched case-insensitively;
 * Projects are already stored lowercase, so the LIKE is enough. Sorted so the
 * list is stable for Capture Predictions.
 */
const SELECT_PROJECT_PREDICTIONS = `
  SELECT DISTINCT project
  FROM notes
  WHERE project IS NOT NULL
    AND project LIKE ? ESCAPE '\\'
  ORDER BY project ASC
`

export function createJournal({
  clock,
  driver,
}: {
  clock: Clock
  driver: SqlDriver
}): Journal {
  return {
    async capture(text) {
      assertOneLine(text)

      const parsed = parseCapture(text)
      if (parsed === null) {
        return null
      }

      const capturedAt = clock.now()
      const note: Note = {
        id: crypto.randomUUID(),
        body: parsed.body,
        project: parsed.project,
        capturedAt: capturedAt.toISOString(),
        // Decided once, at capture, from the local calendar day of Captured At.
        // Never recomputed — see docs/adr/0005-no-day-start.md.
        journalDay: journalDayFor(capturedAt),
        editedAt: null,
        origin: 'capture',
      }

      await driver.execute(INSERT_NOTE, [
        note.id,
        note.body,
        note.project,
        note.capturedAt,
        note.journalDay,
        note.origin,
      ])

      return note
    },

    async importMeeting(event) {
      const key = meetingKey(event)
      const [handled] = await driver.select<{ event_key: string }>(
        SELECT_IMPORTED_MEETING,
        [key],
      )
      if (handled !== undefined) {
        return null
      }

      const began = new Date(event.startsAt)
      const note: Note = {
        id: crypto.randomUUID(),
        body: meetingBody(event.title),
        // Always Unfiled: the calendars carry no Project meaning, so there is
        // nothing to derive — see docs/adr/0010-notes-have-two-origins.md.
        project: null,
        // The instant the meeting began, not the instant it was stored.
        capturedAt: began.toISOString(),
        journalDay: journalDayFor(began),
        editedAt: null,
        origin: 'import',
      }

      // Handled first, and deliberately: an interruption between the two writes
      // loses one meeting, where the other order would resurrect a Note the
      // user may have already deleted. A missed meeting is a gap; a resurrected
      // one is the app overruling the user.
      await driver.execute(INSERT_IMPORTED_MEETING, [
        key,
        clock.now().toISOString(),
      ])
      await driver.execute(INSERT_NOTE, [
        note.id,
        note.body,
        note.project,
        note.capturedAt,
        note.journalDay,
        note.origin,
      ])

      return note
    },

    async editBody(id, body) {
      assertOneLine(body)

      if (isBlank(body)) {
        throw new Error('A Body cannot be empty: delete the Note instead.')
      }

      const note = await read(driver, id)
      const reworded = body.trim()

      if (reworded === note.body) {
        return note
      }

      const editedAt = clock.now().toISOString()
      await driver.execute(UPDATE_BODY, [reworded, editedAt, id])

      return { ...note, body: reworded, editedAt }
    },

    async refile(id, journalDay) {
      if (!isJournalDay(journalDay)) {
        throw new Error(`Not a Journal Day: ${journalDay}.`)
      }

      const note = await read(driver, id)

      if (journalDay === note.journalDay) {
        return note
      }

      const editedAt = clock.now().toISOString()
      await driver.execute(UPDATE_JOURNAL_DAY, [journalDay, editedAt, id])

      return { ...note, journalDay, editedAt }
    },

    async editProject(id, project) {
      const next = normalizeProject(project)
      const note = await read(driver, id)

      if (next === note.project) {
        return note
      }

      const editedAt = clock.now().toISOString()
      await driver.execute(UPDATE_PROJECT, [next, editedAt, id])

      return { ...note, project: next, editedAt }
    },

    async delete(id) {
      await read(driver, id)
      await driver.execute(DELETE_NOTE, [id])
    },

    async defaultRange() {
      const [row] = await driver.select<{ journal_day: string }>(
        SELECT_MOST_RECENT_OCCUPIED_DAY,
        [],
      )

      if (row === undefined) {
        return null
      }

      return rangeForJournalDay(row.journal_day)
    },

    async notesForFilter(filter) {
      const query = selectNotesForFilter(filter, IN_LIST_ORDER)
      const rows = await driver.select<NoteRow>(query.sql, query.params)
      return rows.map(toNote)
    },

    async notesMatching(term) {
      const rows = await driver.select<NoteRow>(SELECT_NOTES_MATCHING, [
        `%${escapeForLike(term)}%`,
      ])
      return rows.map(toNote)
    },

    async digest(filter) {
      const query = selectNotesForFilter(filter, IN_DIGEST_ORDER)
      const rows = await driver.select<NoteRow>(query.sql, query.params)
      return renderDigest(rows.map(toNote), {
        // A single day is the common case and pastes without ceremony; any
        // wider Filter says which day each bullet belongs to.
        headings: filter.from !== filter.to,
        // Under one named Project every bullet would carry the same prefix,
        // which says nothing the reader does not already know.
        projectPrefixes: constraintOf(filter).kind !== 'named',
      })
    },

    async exportJournal() {
      const [noteRows, taskRows] = await Promise.all([
        driver.select<NoteRow>(SELECT_ALL_NOTES_FOR_EXPORT, []),
        driver.select<TaskRow>(SELECT_ALL_TASKS_FOR_EXPORT, []),
      ])
      // An export always spans whatever the journal holds, so every day is
      // named — a file with unlabelled bullets is not a journal — and it is
      // never about one Project, so filing is written on the bullet.
      const notes = renderDigest(noteRows.map(toNote), {
        headings: true,
        projectPrefixes: true,
      })

      return renderExport(notes, taskRows.map(toTask))
    },

    async createTask(description) {
      const said = taskDescription(description)
      const task: Task = {
        id: crypto.randomUUID(),
        description: said,
        createdAt: clock.now().toISOString(),
        completedAt: null,
      }

      await driver.execute(INSERT_TASK, [
        task.id,
        task.description,
        task.createdAt,
      ])

      return task
    },

    async openTasks() {
      const rows = await driver.select<TaskRow>(SELECT_OPEN_TASKS, [])
      return rows.map(toTask)
    },

    async completedTasks() {
      const rows = await driver.select<TaskRow>(SELECT_COMPLETED_TASKS, [])
      return rows.map(toTask)
    },

    async editTaskDescription(id, description) {
      const said = taskDescription(description)
      const task = await readTask(driver, id)

      if (said === task.description) {
        return task
      }

      await driver.execute(UPDATE_TASK_DESCRIPTION, [said, id])

      return { ...task, description: said }
    },

    async completeTask(id) {
      const task = await readTask(driver, id)

      // Completing what is already completed must not move the instant it was
      // completed at: the Completed list is ordered by it.
      if (!isOpen(task)) {
        return task
      }

      const completedAt = clock.now().toISOString()
      await driver.execute(UPDATE_TASK_COMPLETED_AT, [completedAt, id])

      return { ...task, completedAt }
    },

    async reopenTask(id) {
      const task = await readTask(driver, id)

      if (isOpen(task)) {
        return task
      }

      await driver.execute(UPDATE_TASK_COMPLETED_AT, [null, id])

      return { ...task, completedAt: null }
    },

    async deleteTask(id) {
      await readTask(driver, id)
      await driver.execute(DELETE_TASK, [id])
    },

    async projectPredictions(prefix) {
      const rows = await driver.select<{ project: string }>(
        SELECT_PROJECT_PREDICTIONS,
        [`${escapeForLike(prefix.toLowerCase())}%`],
      )
      return rows.map((row) => row.project)
    },

    async projectsInUse() {
      const rows = await driver.select<{ project: string }>(
        SELECT_PROJECTS_IN_USE,
        [],
      )
      return rows.map((row) => row.project)
    },

    async capturedNoteCount(journalDay) {
      const [row] = await driver.select<{ count: number }>(
        COUNT_CAPTURED_NOTES_ON_DAY,
        [journalDay],
      )
      return row?.count ?? 0
    },
  }
}

/**
 * Notes as Markdown, oldest first, one bullet each and no timestamps — a
 * Digest is meant to paste into a standup thread or an LLM prompt with no
 * cleanup, so it carries nothing the app knows and the reader does not need.
 *
 * Headings and Project prefixes are the caller's decision rather than the
 * Notes': what is being rendered decides whether a bullet needs to say which
 * day it belongs to, and whether the reader already knows which Project it
 * came from. Days with no Notes are simply absent either way.
 *
 * `notes` must already be in Digest order, which is what the core's read does.
 */
function renderDigest(
  notes: Note[],
  { headings, projectPrefixes }: { headings: boolean; projectPrefixes: boolean },
): Digest {
  const days = groupByJournalDay(notes)

  const markdown = days
    .map((day) => {
      const bullets = day.notes
        .map((note) => `- ${bulletPrefix(note, projectPrefixes)}${note.body}`)
        .join('\n')
      return headings
        ? `## ${formatDigestDay(day.journalDay)}\n${bullets}`
        : bullets
    })
    .join('\n\n')

  return { markdown, noteCount: notes.length }
}

/**
 * The whole journal as one file: the Notes already rendered, and the Tasks
 * under Open and Completed beside them. Two top-level sections, because a Note
 * and a Task are separate records and a file that ran them together would say
 * they are not.
 *
 * A section with nothing in it is left out entirely rather than written as an
 * empty heading, so a journal of Tasks alone exports as Tasks rather than as
 * Notes that are not there — and an empty journal exports as nothing at all.
 *
 * `tasks` must be in export order: oldest first, both states together.
 */
function renderExport(notes: Digest, tasks: Task[]): JournalExport {
  const open = tasks.filter(isOpen)
  const completed = tasks.filter((task) => !isOpen(task))

  const sections: string[] = []

  if (notes.noteCount > 0) {
    sections.push(`# Notes\n\n${notes.markdown}`)
  }

  if (tasks.length > 0) {
    const parts: string[] = ['# Tasks']
    if (open.length > 0) {
      parts.push(`## Open\n${open.map(taskBullet).join('\n')}`)
    }
    if (completed.length > 0) {
      parts.push(`## Completed\n${completed.map(taskBullet).join('\n')}`)
    }
    sections.push(parts.join('\n\n'))
  }

  return {
    markdown: sections.join('\n\n'),
    noteCount: notes.noteCount,
    taskCount: tasks.length,
  }
}

/**
 * One Task as Markdown reads a commitment: a checkbox saying which state it is
 * in, the description as written, and — only when there is one — the day it was
 * completed. Absent metadata is omitted rather than written as a blank, so a
 * line says nothing the journal does not know.
 */
function taskBullet(task: Task): string {
  if (task.completedAt === null) {
    return `- [ ] ${task.description}`
  }

  return `- [x] ${task.description} (completed ${formatExportInstant(task.completedAt)})`
}

/**
 * An instant as an export writes it: the day the way a Digest heading spells
 * one, and the local time of day after it. Both, because Task Completed At is
 * an instant rather than a day — an export that kept only the date would be
 * lossier than the record it is a copy of. Pinned to `en-GB` and to 24 hours
 * for the same reason `formatDigestDay` is: a file whose shape depends on the
 * machine that produced it is worse than one that is merely British.
 */
function formatExportInstant(instant: string): string {
  const at = new Date(instant)
  const time = [
    String(at.getHours()).padStart(2, '0'),
    String(at.getMinutes()).padStart(2, '0'),
  ].join(':')

  return `${formatDigestDay(journalDayFor(at))}, ${time}`
}

/**
 * What a bullet says before the Body: `#name ` when the Note has a Project and
 * the rendering is not already about one, and nothing otherwise. An Unfiled
 * Note is never labelled — a bullet with no marker is one nobody filed.
 */
function bulletPrefix(note: Note, projectPrefixes: boolean): string {
  return projectPrefixes && note.project !== null ? `#${note.project} ` : ''
}

/**
 * What a copied Digest is worth saying back: how many Notes went to the
 * clipboard, so the reader knows it worked before they paste. An empty Filter
 * says so rather than claiming a copy that carried nothing.
 */
export function describeCopiedDigest(digest: Digest): string {
  if (digest.noteCount === 0) {
    return 'No Notes to copy.'
  }
  return `Copied ${plural(digest.noteCount, 'Note')}.`
}

/**
 * What an export is worth saying back: both counts and where the file went. A
 * journal holding only Tasks says so, rather than reporting no Notes and
 * reading as an export that carried nothing.
 */
export function describeExport(
  exported: JournalExport,
  path: string,
): string {
  const { noteCount, taskCount } = exported

  if (noteCount === 0 && taskCount === 0) {
    return `Exported an empty journal to ${path}.`
  }

  const counted = [
    noteCount > 0 ? plural(noteCount, 'Note') : null,
    taskCount > 0 ? plural(taskCount, 'Task') : null,
  ].filter((part) => part !== null)

  return `Exported ${counted.join(' and ')} to ${path}.`
}

function plural(count: number, thing: string): string {
  return `${count} ${thing}${count === 1 ? '' : 's'}`
}

/**
 * A Journal Day as a Digest heading: short enough to read as a date in a
 * standup thread. In UTC for the same reason as `formatJournalDay`.
 *
 * Pinned to `en-GB` on purpose, unlike the on-screen formatters. A Digest is
 * output — pasted into a thread or a prompt — and a heading whose shape depends
 * on the machine that produced it is worse than one that is merely British.
 */
function formatDigestDay(journalDay: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(journalDay))
}

/**
 * The Journal Day an instant falls under: the local calendar day of Captured
 * At, midnight boundary. Pure, and built from local calendar parts so a day
 * containing a DST transition still resolves to exactly one day.
 */
export function journalDayFor(instant: Date): string {
  return [
    String(instant.getFullYear()).padStart(4, '0'),
    String(instant.getMonth() + 1).padStart(2, '0'),
    String(instant.getDate()).padStart(2, '0'),
  ].join('-')
}

/**
 * Which of today's events are to become Notes on this sweep. Everything Import
 * decides is here, so a sweep is this list and nothing else:
 *
 * - a calendar the user has not ticked is ignored entirely;
 * - a meeting becomes a Note as it *ends*, never while it is still running;
 * - only meetings that *ran during today* are swept, and only back as far as
 *   yesterday's midnight: Import covers the current day and nothing else, so
 *   nothing is ever backfilled — see
 *   docs/adr/0011-imported-meetings-are-today-only.md. The one meeting that
 *   began before today and is still swept is the one that was running as today
 *   began: it ends today, and anchoring on its start alone would mean no sweep
 *   could ever reach it — before midnight it has not ended, and after midnight
 *   it no longer began today;
 * - a declined event never becomes one — the user was not there;
 * - nor does an event covering the whole local day, whether or not the calendar
 *   marks it all-day: an out-of-office block running local midnight to midnight
 *   reports `isAllDay: false` and would otherwise arrive as a meeting that
 *   began at 00:00.
 *
 * There is no duration floor. A missed meeting is worse than an extra one,
 * because an extra one is deleted in a second and an absence is never noticed.
 *
 * Already-handled meetings are not filtered here: that is a fact about the
 * journal rather than about the calendar, and `importMeeting` holds it.
 */
export function meetingsToImport({
  events,
  calendarIds,
  now,
}: {
  events: CalendarEvent[]
  /** The ticked calendars. Empty means nothing is swept at all. */
  calendarIds: string[]
  now: Date
}): CalendarEvent[] {
  const ticked = new Set(calendarIds)
  const instant = now.getTime()
  const today = localMidnight(now)
  const yesterday = localMidnight(now, -1)

  return events.filter(
    (event) =>
      ticked.has(event.calendarId) &&
      !event.isDeclined &&
      event.endsAt <= instant &&
      event.endsAt > today &&
      event.startsAt >= yesterday &&
      !coversWholeLocalDay(event),
  )
}

/**
 * The instant a local calendar day began, `offsetInDays` from the one the given
 * instant falls under. Built from local calendar parts rather than by
 * subtracting hours, so the day either side of a DST transition still starts at
 * its own midnight.
 */
function localMidnight(instant: Date, offsetInDays = 0): number {
  return new Date(
    instant.getFullYear(),
    instant.getMonth(),
    instant.getDate() + offsetInDays,
  ).getTime()
}

/**
 * Whether an event blankets the local day its Journal Day would fall under:
 * starting at or before that midnight and ending at or after the next. True of
 * a genuine all-day event, of a multi-day one, and of the midnight-to-midnight
 * block a calendar does not mark as all-day. An event that merely runs long —
 * 00:00 to 23:00 — is a real thing that happened, and is not one of these.
 */
function coversWholeLocalDay(event: CalendarEvent): boolean {
  if (event.isAllDay) {
    return true
  }

  const began = new Date(event.startsAt)

  return (
    event.startsAt <= localMidnight(began) &&
    event.endsAt >= localMidnight(began, 1)
  )
}

/**
 * One occurrence of one event, as the journal remembers having handled it. A
 * recurring meeting shares its identifier across every occurrence, so the
 * instant it began is part of the identity — otherwise a daily standup would be
 * imported once and silently skipped for the rest of time.
 */
export function meetingKey(event: CalendarEvent): string {
  return `${event.id}@${new Date(event.startsAt).toISOString()}`
}

/** What an untitled meeting reads as, since a Body is never empty. */
export const UNTITLED_MEETING = '(untitled meeting)'

/**
 * A meeting's title as a Body: verbatim, but a Body is one line, so any run of
 * whitespace — including the line breaks a calendar allows in a title —
 * collapses to a single space.
 */
export function meetingBody(title: string): string {
  const body = title.replace(/\s+/g, ' ').trim()
  return body === '' ? UNTITLED_MEETING : body
}

/** An en dash: a rule wide enough to notice, and narrower than a digit. */
const EMPTY_DAY = '–'

/**
 * Today's Captured Note count as the menu bar reads it, beside the glyph.
 *
 * Zero is a dash rather than a `0`, because the two say different things in a
 * place this small: a `0` is a total, and a total reads as a day that has been
 * accounted for. A dash reads as a blank still waiting to be filled — which is
 * the whole reason the count is up there, since the app never asks for a Note
 * any other way.
 */
export function formatTrayCount(count: number): string {
  return count === 0 ? EMPTY_DAY : String(count)
}

/**
 * How long until the Journal Day changes — what the tray count waits out
 * before it starts the next day at nothing.
 *
 * Counted to the next local midnight rather than by adding a day's worth of
 * milliseconds: a day either side of a DST transition is 23 or 25 hours long,
 * and a fixed 24 would roll the count over at the wrong hour twice a year.
 */
export function msUntilNextJournalDay(now: Date): number {
  const midnight = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
  )
  return midnight.getTime() - now.getTime()
}

/**
 * What an export is called: the journal, and the day it was taken. Dated so a
 * second export sits beside the first as a later snapshot rather than as an
 * anonymous copy.
 */
export function exportFileName(taken: Date): string {
  const day = [
    String(taken.getFullYear()).padStart(4, '0'),
    String(taken.getMonth() + 1).padStart(2, '0'),
    String(taken.getDate()).padStart(2, '0'),
  ].join('-')

  return `work-journal-${day}.md`
}

/** The Notes of one Journal Day, under the day they are filed under. */
export interface JournalDayGroup {
  journalDay: string
  notes: Note[]
}

/**
 * Notes under day headings, in the order they arrive. A Filter is a range, so
 * a result can span several days and each day says which one it is.
 */
export function groupByJournalDay(notes: Note[]): JournalDayGroup[] {
  const groups: JournalDayGroup[] = []

  for (const note of notes) {
    const open = groups.at(-1)
    if (open?.journalDay === note.journalDay) {
      open.notes.push(note)
    } else {
      groups.push({ journalDay: note.journalDay, notes: [note] })
    }
  }

  return groups
}

/**
 * A Journal Day as a heading. In the reader's own locale, so the date reads the
 * way the rest of their machine does. Formatted in UTC because a Journal Day is
 * a label rather than an instant: `YYYY-MM-DD` parses as UTC midnight, which is
 * the previous evening in a negative offset.
 */
export function formatJournalDay(journalDay: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(journalDay))
}

/**
 * Captured At as the local time of day it happened at, in the reader's own
 * locale — including whether that locale writes a 12- or 24-hour clock.
 */
export function formatTimeOfDay(capturedAt: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(capturedAt))
}

/**
 * Task Completed At as Tasks View reads it: the day and the time of day, in the
 * reader's own locale. The day is part of it because the Completed list spans
 * the whole journal — a bare clock time would read as today's on a Task
 * completed a month ago.
 */
export function formatTaskCompletedAt(completedAt: string): string {
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(completedAt))
}

/**
 * A Note's Project as it reads on screen: `#name`, or Unfiled when there is
 * none. The filing label History shows next to every Body.
 */
export function formatProject(project: string | null): string {
  return project === null ? 'Unfiled' : `#${project}`
}

/**
 * A Project constraint as the value of a picker, and back. `#` cannot occur in
 * a Project name, so a Project called `any` or `unfiled` is still its own
 * choice rather than one of the two constants.
 */
export function projectChoice(constraint: ProjectConstraint): string {
  return constraint.kind === 'named' ? `#${constraint.name}` : constraint.kind
}

/** And back: the value a picker reports, as the constraint it stands for. */
export function projectConstraintFor(choice: string): ProjectConstraint {
  if (choice === 'unfiled') return UNFILED
  if (choice.startsWith('#')) {
    return { kind: 'named', name: projectName(choice.slice(1)) }
  }
  return ANY_PROJECT
}

/** One Journal Day as a day range: a range whose ends are equal. */
export function rangeForJournalDay(journalDay: string): DayRange {
  return { from: journalDay, to: journalDay }
}

/**
 * A range of Journal Days, whichever end the reader picked first. A range
 * always reads oldest end first, so the two ends of a picker cannot put the
 * core in a state that selects nothing.
 */
export function rangeForDays(oneEnd: string, otherEnd: string): DayRange {
  return oneEnd <= otherEnd
    ? { from: oneEnd, to: otherEnd }
    : { from: otherEnd, to: oneEnd }
}

/**
 * A named civil-time range relative to today. One-shot: the clock is read when
 * the Preset is chosen, and the result is an ordinary day range — nothing
 * sticky, nothing rolling, and nothing about the Project axis, which a Preset
 * never touches. Week starts Monday. "This" units run from the unit start
 * through today; "last" units are the full prior calendar unit.
 */
export type FilterPreset =
  | 'today'
  | 'yesterday'
  | 'this-week'
  | 'last-week'
  | 'this-month'
  | 'last-month'

export function rangeForPreset(preset: FilterPreset, today: string): DayRange {
  switch (preset) {
    case 'today':
      return rangeForJournalDay(today)
    case 'yesterday':
      return rangeForJournalDay(shiftDay(today, -1))
    case 'this-week':
      return { from: startOfWeek(today), to: today }
    case 'last-week': {
      const thisMonday = startOfWeek(today)
      const lastMonday = shiftDay(thisMonday, -7)
      return { from: lastMonday, to: shiftDay(lastMonday, 6) }
    }
    case 'this-month':
      return { from: startOfMonth(today), to: today }
    case 'last-month': {
      const [year, month] = parts(today)
      const prior = month === 1 ? [year - 1, 12] : [year, month - 1]
      const from = dayLabel(prior[0], prior[1], 1)
      const to = dayLabel(prior[0], prior[1], daysInMonth(prior[0], prior[1]))
      return { from, to }
    }
  }
}

/** Calendar arithmetic on a `YYYY-MM-DD` label, not an instant. */
function parts(journalDay: string): [number, number, number] {
  const [year, month, day] = journalDay.split('-').map(Number)
  return [year, month, day]
}

function dayLabel(year: number, month: number, day: number): string {
  return [
    String(year).padStart(4, '0'),
    String(month).padStart(2, '0'),
    String(day).padStart(2, '0'),
  ].join('-')
}

function shiftDay(journalDay: string, days: number): string {
  const [year, month, day] = parts(journalDay)
  // Local Date so month overflow and leap days land on the civil calendar.
  return journalDayFor(new Date(year, month - 1, day + days))
}

function startOfWeek(journalDay: string): string {
  const [year, month, day] = parts(journalDay)
  const date = new Date(year, month - 1, day)
  // JS Sunday=0 … Saturday=6 → days since Monday.
  const sinceMonday = (date.getDay() + 6) % 7
  return shiftDay(journalDay, -sinceMonday)
}

function startOfMonth(journalDay: string): string {
  const [year, month] = parts(journalDay)
  return dayLabel(year, month, 1)
}

function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month is the last day of this one.
  return new Date(year, month, 0).getDate()
}

/**
 * A newly captured Note against the days on screen. A Note filed under a day
 * in view belongs in the list; one filed outside it must not move the list
 * under a reader, so it becomes a nudge naming the day that gained content —
 * moving the Filter there stays the reader's decision.
 *
 * The day axis and nothing else: a Note the Project constraint excludes is
 * simply not in the list, because a mismatch there is too ordinary to announce
 * — see docs/adr/0008-project-narrows-filter.md.
 *
 * `YYYY-MM-DD` compares as a string in calendar order, which is why a range is
 * a pair of them.
 */
export function decideArrival(
  range: DayRange,
  journalDay: string,
): ArrivalDecision {
  if (journalDay >= range.from && journalDay <= range.to) {
    return { kind: 'show' }
  }
  return { kind: 'nudge', journalDay }
}

/**
 * A keystroke plus the current field text, as a decision. The app's most
 * repeated interaction, kept out of the view so it is testable without
 * rendering anything.
 */
export function decideKeystroke(key: string, text: string): KeystrokeDecision {
  if (key === 'Escape') {
    return 'discard'
  }
  if (key === 'Enter') {
    // A bare Project Marker is nothing to commit, same as blank input.
    return parseCapture(text) === null ? 'ignore' : 'commit'
  }
  return 'ignore'
}

/**
 * The prefix of an open Project Marker being typed at the start of Capture.
 * Null once a Body has begun or there is no leading marker — Predictions only
 * surface while the marker itself is still being written.
 */
export function markerPrefix(text: string): string | null {
  const open = /^#([A-Za-z0-9_-]*)$/.exec(text)
  return open === null ? null : open[1]
}

/**
 * Choosing a Prediction: fill the open marker with `#name` and a trailing
 * space so the Body can follow. The user can still edit before commit.
 */
export function applyPrediction(name: string): string {
  return `#${name} `
}

/**
 * The Note an operation was asked to change. Every correction starts here, so
 * changing a Note that is no longer there fails loudly rather than silently
 * updating nothing.
 */
async function read(driver: SqlDriver, id: string): Promise<Note> {
  const [row] = await driver.select<NoteRow>(SELECT_NOTE, [id])

  if (row === undefined) {
    throw new Error(`No such Note: ${id}.`)
  }

  return toNote(row)
}

/**
 * The Task an operation was asked to change. Every Task correction starts
 * here, so changing one that is no longer there fails loudly rather than
 * silently updating nothing.
 */
async function readTask(driver: SqlDriver, id: string): Promise<Task> {
  const [row] = await driver.select<TaskRow>(SELECT_TASK, [id])

  if (row === undefined) {
    throw new Error(`No such Task: ${id}.`)
  }

  return toTask(row)
}

/**
 * A Task Description as the journal stores it: trimmed at its ends, and
 * otherwise exactly what was written — internal whitespace and every kind of
 * Unicode survive verbatim, and nothing in it is read for meaning. There is no
 * length limit; the only rule is that it says something, on one line.
 */
function taskDescription(description: string): string {
  if (/[\n\r]/.test(description)) {
    throw new Error(
      'A Task Description is one line: it cannot contain a line break.',
    )
  }

  const said = description.trim()
  if (said === '') {
    throw new Error('A Task Description cannot be empty.')
  }

  return said
}

function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    description: row.description,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  }
}

/**
 * A Journal Day is a `YYYY-MM-DD` label, not a date to be parsed — but the
 * shape alone is not the rule. A journal of work notes files nothing in the
 * third century, so the year is bounded: it keeps a half-typed year out of the
 * database, since a date input hands over `0002-07-31` on the way to `2026`.
 */
function isJournalDay(journalDay: string): boolean {
  return /^[2-9]\d{3}-\d{2}-\d{2}$/.test(journalDay)
}

/**
 * A Project name as the journal stores it, or Unfiled. Null is Unfiled. A
 * string is trimmed and lowercased; only letters, digits, `_` and `-` are
 * allowed, and it must not be empty — the same rule Capture's marker uses, so
 * a name typed in History is one Capture could have written.
 */
function normalizeProject(project: string | null): string | null {
  return project === null ? null : projectName(project)
}

/**
 * Whether the journal would accept this as a Project name. The same rule
 * `projectName` enforces, asked rather than thrown — a picker offering a name
 * the record is going to refuse is offering a choice that is not one.
 */
export function isProjectName(project: string): boolean {
  try {
    projectName(project)
    return true
  } catch {
    return false
  }
}

/** The same rule for a name that is definitely one: a Project, or an error. */
function projectName(project: string): string {
  const name = project.trim().toLowerCase()
  if (name === '' || !/^[a-z0-9_-]+$/.test(name)) {
    throw new Error(`Not a Project: ${project}.`)
  }

  return name
}

/**
 * A term as the literal text it is. What a reader types is a substring of a
 * Body, so `LIKE`'s own wildcards have to be spelled out: `50%` finds the Note
 * about the queue rather than every Note in the journal.
 */
function escapeForLike(term: string): string {
  return term.replace(/[\\%_]/g, (character) => `\\${character}`)
}

/** Nothing to commit: a Capture ends in one Note or in nothing at all. */
function isBlank(body: string): boolean {
  return body.trim() === ''
}

/**
 * A Capture as Project + Body. A leading `#name` Project Marker is consumed:
 * Project is set lowercase, Body is whatever follows. A bare marker, or blank
 * input, is nothing to commit. Mid-line or malformed `#` stays plain Body.
 */
function parseCapture(
  text: string,
): { project: string | null; body: string } | null {
  const trimmed = text.trim()
  if (trimmed === '') {
    return null
  }

  const marker = /^#([A-Za-z0-9_-]+)(?:\s+(.*))?$/.exec(trimmed)
  if (marker === null) {
    return { project: null, body: trimmed }
  }

  const body = (marker[2] ?? '').trim()
  if (body === '') {
    return null
  }

  return { project: marker[1].toLowerCase(), body }
}

/** The Body invariant, held in one place: a Note is a remark, not a document. */
function assertOneLine(body: string): void {
  if (/[\n\r]/.test(body)) {
    throw new Error('A Body is one line: it cannot contain a line break.')
  }
}

function toNote(row: NoteRow): Note {
  return {
    id: row.id,
    body: row.body,
    project: row.project,
    capturedAt: row.captured_at,
    journalDay: row.journal_day,
    editedAt: row.edited_at,
    // A row written before Import existed has no origin of its own; the column
    // defaults for those, and anything else at all is read as typed rather than
    // silently rendering a Note the user wrote as one they did not.
    origin: row.origin === 'import' ? 'import' : 'capture',
  }
}
