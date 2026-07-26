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

/** The whole of the app's storage surface: a SQL string plus parameters. */
export interface SqlDriver {
  execute(sql: string, params: unknown[]): Promise<unknown>
  select<Row>(sql: string, params: unknown[]): Promise<Row[]>
}

export interface Note {
  id: string
  /** A single line, never empty or whitespace-only. */
  body: string
  /** UTC ISO-8601. Provenance, not filing — never changes. */
  capturedAt: string
  /** `YYYY-MM-DD`. Decided at capture and never recomputed. */
  journalDay: string
  /** Null until the Note is changed after capture. */
  editedAt: string | null
}

/** What a keystroke during a Capture means. */
export type KeystrokeDecision = 'commit' | 'discard' | 'ignore'

/**
 * The hour at which one Journal Day gives way to the next. User-configurable
 * later; fixed here so work done after midnight files under the day it felt
 * like.
 */
export const DEFAULT_DAY_START_HOUR = 4

export interface Journal {
  /**
   * Commits one Note, or nothing at all — a Capture never ends in a partial or
   * empty Note. Returns null when there was nothing to commit.
   */
  capture(body: string): Promise<Note | null>
  /**
   * The Notes filed under one Journal Day, oldest first — the order a Digest
   * reads in. How the history window orders them is its own decision.
   */
  notesForJournalDay(journalDay: string): Promise<Note[]>
}

interface NoteRow {
  id: string
  body: string
  captured_at: string
  journal_day: string
  edited_at: string | null
}

const INSERT_NOTE = `
  INSERT INTO notes (id, body, captured_at, journal_day, edited_at)
  VALUES (?, ?, ?, ?, NULL)
`

const SELECT_NOTES_FOR_JOURNAL_DAY = `
  SELECT id, body, captured_at, journal_day, edited_at
  FROM notes
  WHERE journal_day = ?
  ORDER BY captured_at ASC, id ASC
`

export function createJournal({
  clock,
  driver,
  dayStartHour = DEFAULT_DAY_START_HOUR,
}: {
  clock: Clock
  driver: SqlDriver
  dayStartHour?: number
}): Journal {
  return {
    async capture(body) {
      if (containsLineBreak(body)) {
        throw new Error('A Body is one line: it cannot contain a line break.')
      }

      if (isBlank(body)) {
        return null
      }

      const capturedAt = clock.now()
      const note: Note = {
        id: crypto.randomUUID(),
        body: body.trim(),
        capturedAt: capturedAt.toISOString(),
        journalDay: journalDayFor(capturedAt, dayStartHour),
        editedAt: null,
      }

      await driver.execute(INSERT_NOTE, [
        note.id,
        note.body,
        note.capturedAt,
        note.journalDay,
      ])

      return note
    },

    async notesForJournalDay(journalDay) {
      const rows = await driver.select<NoteRow>(SELECT_NOTES_FOR_JOURNAL_DAY, [
        journalDay,
      ])
      return rows.map(toNote)
    },
  }
}

/**
 * The Journal Day an instant falls under. Pure, and computed from local
 * calendar parts rather than by subtracting hours, so a day containing a DST
 * transition still resolves to exactly one day.
 */
export function journalDayFor(instant: Date, dayStartHour: number): string {
  // Anchored at noon so the arithmetic never lands on a local time that a DST
  // transition skipped.
  const day = new Date(
    instant.getFullYear(),
    instant.getMonth(),
    instant.getDate(),
    12,
  )

  if (instant.getHours() < dayStartHour) {
    day.setDate(day.getDate() - 1)
  }

  return [
    String(day.getFullYear()).padStart(4, '0'),
    String(day.getMonth() + 1).padStart(2, '0'),
    String(day.getDate()).padStart(2, '0'),
  ].join('-')
}

/**
 * A keystroke plus the current field text, as a decision. The app's most
 * repeated interaction, kept out of the view so it is testable without
 * rendering anything.
 */
export function decideKeystroke(key: string, body: string): KeystrokeDecision {
  if (key === 'Escape') {
    return 'discard'
  }
  if (key === 'Enter') {
    return isBlank(body) ? 'ignore' : 'commit'
  }
  return 'ignore'
}

/** Nothing to commit: a Capture ends in one Note or in nothing at all. */
function isBlank(body: string): boolean {
  return body.trim() === ''
}

function containsLineBreak(body: string): boolean {
  return /[\n\r]/.test(body)
}

function toNote(row: NoteRow): Note {
  return {
    id: row.id,
    body: row.body,
    capturedAt: row.captured_at,
    journalDay: row.journal_day,
    editedAt: row.edited_at,
  }
}
