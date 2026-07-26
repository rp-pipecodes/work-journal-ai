import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event'
import Database from '@tauri-apps/plugin-sql'
import { createJournal, type Journal, type Note, type SqlDriver } from './journal'

/** Must match `DATABASE_URL` in `src-tauri/src/lib.rs`. */
const DATABASE_URL = 'sqlite:work-journal.db'

/**
 * A Note was committed. Capture and History are separate windows over one
 * database, so a window already on screen only learns of a new Note by being
 * told — it never polls, and it never re-reads on a timer.
 */
const NOTE_CAPTURED_EVENT = 'note://captured'

/** Only the Journal Day matters to a listener: it decides what to do next. */
interface NoteCaptured {
  journalDay: string
}

export function announceCapturedNote(note: Note): Promise<void> {
  return emit(NOTE_CAPTURED_EVENT, { journalDay: note.journalDay })
}

export function onNoteCaptured(
  handle: (journalDay: string) => void,
): Promise<UnlistenFn> {
  return listen<NoteCaptured>(NOTE_CAPTURED_EVENT, ({ payload }) =>
    handle(payload.journalDay),
  )
}

let loading: Promise<Journal> | null = null

/**
 * The one journal the running app uses: the core, wired to the real clock and
 * to plugin-sql. Loaded once and shared, because the capture window outlives
 * every Capture made through it.
 */
export function journal(): Promise<Journal> {
  loading ??= load()
  return loading
}

async function load(): Promise<Journal> {
  const database = await Database.load(DATABASE_URL)

  const driver: SqlDriver = {
    execute: (sql, params) => database.execute(sql, params),
    select: (sql, params) => database.select(sql, params),
  }

  return createJournal({ clock: { now: () => new Date() }, driver })
}
