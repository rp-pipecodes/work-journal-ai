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

/**
 * The range of Journal Days currently being viewed, inclusive at both ends. A
 * single day is a range whose ends are equal.
 */
export interface Filter {
  /** `YYYY-MM-DD`, the oldest day in view. */
  from: string
  /** `YYYY-MM-DD`, the newest day in view. */
  to: string
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
   * empty Note. Returns null when there was nothing to commit.
   */
  capture(body: string): Promise<Note | null>
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
   * Removes a Note permanently. There is no trash, no archive and no
   * `deleted_at` — the row is gone, and with it every Filter and Digest it
   * appeared in.
   */
  delete(id: string): Promise<void>
  /**
   * The Filter a reader starts from: the most recent Occupied Day, which is
   * the greatest Journal Day present and not yesterday's date — so a Monday
   * resolves to Friday when the weekend is empty, however long the gap. Null
   * when there are no Notes at all, rather than an arbitrary date.
   */
  defaultFilter(): Promise<Filter | null>
  /**
   * The Notes in a Filter, newest first — the order someone reading back at
   * standup wants, and the reverse of a Digest's.
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
   */
  digest(filter: Filter): Promise<Digest>
  /**
   * Every Note in the journal as Markdown, under a heading for each day — the
   * way out of the SQLite file, so nothing captured here is locked in. Every
   * Note appears exactly once, whatever Filter the reader last looked at.
   *
   * An Export is rendered exactly as a Digest is, and so has the same shape,
   * but it is not one: a Digest is bound to the Filter on screen and an Export
   * ignores the Filter entirely.
   */
  exportAll(): Promise<Digest>
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

/** Every read returns a whole Note; only the predicate and the order differ. */
const SELECT_NOTES = `
  SELECT id, body, captured_at, journal_day, edited_at
  FROM notes
`

const SELECT_NOTE = `
  ${SELECT_NOTES}
  WHERE id = ?
`

/**
 * Body and Journal Day are the two changeable columns, and both mark the Note
 * as edited; `captured_at` is never in an UPDATE anywhere in the app.
 */
const UPDATE_BODY = `
  UPDATE notes SET body = ?, edited_at = ? WHERE id = ?
`

const UPDATE_JOURNAL_DAY = `
  UPDATE notes SET journal_day = ?, edited_at = ? WHERE id = ?
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

const SELECT_NOTES_FOR_FILTER = `
  ${SELECT_NOTES}
  WHERE journal_day BETWEEN ? AND ?
  ORDER BY journal_day DESC, captured_at DESC, id DESC
`

/**
 * The same order as a Filter's list, over the whole journal and predicated on
 * the Body instead. `LIKE` is case-insensitive for ASCII in SQLite, which is
 * the whole of the matching rule; the escape character is named so that a term
 * containing `%` or `_` reads as those characters rather than as a pattern.
 */
const SELECT_NOTES_MATCHING = `
  ${SELECT_NOTES}
  WHERE body LIKE ? ESCAPE '\\'
  ORDER BY journal_day DESC, captured_at DESC, id DESC
`

/** Chronological: the order Markdown reads in, whatever is being rendered. */
const IN_DIGEST_ORDER = `ORDER BY journal_day ASC, captured_at ASC, id ASC`

/** The same rows as a Filter's, in the order a Digest reads in. */
const SELECT_NOTES_FOR_DIGEST = `
  ${SELECT_NOTES}
  WHERE journal_day BETWEEN ? AND ?
  ${IN_DIGEST_ORDER}
`

/** The same rows again with no predicate at all: the whole journal. */
const SELECT_ALL_NOTES_FOR_EXPORT = `
  ${SELECT_NOTES}
  ${IN_DIGEST_ORDER}
`

export function createJournal({
  clock,
  driver,
}: {
  clock: Clock
  driver: SqlDriver
}): Journal {
  return {
    async capture(body) {
      assertOneLine(body)

      if (isBlank(body)) {
        return null
      }

      const capturedAt = clock.now()
      const note: Note = {
        id: crypto.randomUUID(),
        body: body.trim(),
        capturedAt: capturedAt.toISOString(),
        // Decided once, at capture, from the local calendar day of Captured At.
        // Never recomputed — see docs/adr/0005-no-day-start.md.
        journalDay: journalDayFor(capturedAt),
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

    async delete(id) {
      await read(driver, id)
      await driver.execute(DELETE_NOTE, [id])
    },

    async defaultFilter() {
      const [row] = await driver.select<{ journal_day: string }>(
        SELECT_MOST_RECENT_OCCUPIED_DAY,
        [],
      )

      if (row === undefined) {
        return null
      }

      return filterForJournalDay(row.journal_day)
    },

    async notesForFilter(filter) {
      const rows = await driver.select<NoteRow>(SELECT_NOTES_FOR_FILTER, [
        filter.from,
        filter.to,
      ])
      return rows.map(toNote)
    },

    async notesMatching(term) {
      const rows = await driver.select<NoteRow>(SELECT_NOTES_MATCHING, [
        `%${escapeForLike(term)}%`,
      ])
      return rows.map(toNote)
    },

    async digest(filter) {
      const rows = await driver.select<NoteRow>(SELECT_NOTES_FOR_DIGEST, [
        filter.from,
        filter.to,
      ])
      // A single day is the common case and pastes without ceremony; any wider
      // Filter says which day each bullet belongs to.
      return renderDigest(rows.map(toNote), filter.from !== filter.to)
    },

    async exportAll() {
      const rows = await driver.select<NoteRow>(SELECT_ALL_NOTES_FOR_EXPORT, [])
      // An export always spans whatever the journal holds, so every day is
      // named — a file with unlabelled bullets is not a journal.
      return renderDigest(rows.map(toNote), true)
    },
  }
}

/**
 * Notes as Markdown, oldest first, one bullet each and no timestamps — a
 * Digest is meant to paste into a standup thread or an LLM prompt with no
 * cleanup, so it carries nothing the app knows and the reader does not need.
 *
 * Headings are the caller's decision rather than the Notes': what is being
 * rendered decides whether a bullet needs to say which day it belongs to. Days
 * with no Notes are simply absent either way.
 *
 * `notes` must already be in Digest order, which is what the core's read does.
 */
function renderDigest(notes: Note[], headings: boolean): Digest {
  const days = groupByJournalDay(notes)

  const markdown = days
    .map((day) => {
      const bullets = day.notes.map((note) => `- ${note.body}`).join('\n')
      return headings
        ? `## ${formatDigestDay(day.journalDay)}\n${bullets}`
        : bullets
    })
    .join('\n\n')

  return { markdown, noteCount: notes.length }
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
  return `Copied ${digest.noteCount} Note${digest.noteCount === 1 ? '' : 's'}.`
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

/** One Journal Day as a Filter: a range whose ends are equal. */
export function filterForJournalDay(journalDay: string): Filter {
  return { from: journalDay, to: journalDay }
}

/**
 * A range of Journal Days as a Filter, whichever end the reader picked first.
 * A Filter always reads oldest end first, so the two ends of a picker cannot
 * put the core in a state that selects nothing.
 */
export function filterForRange(oneEnd: string, otherEnd: string): Filter {
  return oneEnd <= otherEnd
    ? { from: oneEnd, to: otherEnd }
    : { from: otherEnd, to: oneEnd }
}

/**
 * A newly captured Note against the Filter on screen. A Note filed under a day
 * in view belongs in the list; one filed outside it must not move the list
 * under a reader, so it becomes a nudge naming the day that gained content —
 * moving the Filter there stays the reader's decision.
 *
 * `YYYY-MM-DD` compares as a string in calendar order, which is why the Filter
 * is a pair of them.
 */
export function decideArrival(
  filter: Filter,
  journalDay: string,
): ArrivalDecision {
  if (journalDay >= filter.from && journalDay <= filter.to) {
    return { kind: 'show' }
  }
  return { kind: 'nudge', journalDay }
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
 * A Journal Day is a `YYYY-MM-DD` label, not a date to be parsed — but the
 * shape alone is not the rule. A journal of work notes files nothing in the
 * third century, so the year is bounded: it keeps a half-typed year out of the
 * database, since a date input hands over `0002-07-31` on the way to `2026`.
 */
function isJournalDay(journalDay: string): boolean {
  return /^[2-9]\d{3}-\d{2}-\d{2}$/.test(journalDay)
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
    capturedAt: row.captured_at,
    journalDay: row.journal_day,
    editedAt: row.edited_at,
  }
}
