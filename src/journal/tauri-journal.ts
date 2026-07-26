import Database from '@tauri-apps/plugin-sql'
import { createJournal, type Journal, type SqlDriver } from './journal'

/** Must match `DATABASE_URL` in `src-tauri/src/lib.rs`. */
const DATABASE_URL = 'sqlite:work-journal.db'

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
