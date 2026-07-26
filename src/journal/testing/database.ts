import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
// Node's built-in SQLite is still behind an experimental warning; it is used
// here only so the suite can exercise real SQL without Tauri running. In
// production the driver is plugin-sql.
import { DatabaseSync } from 'node:sqlite'
import type { Clock, SqlDriver } from '../journal'

const MIGRATIONS_DIR = join(import.meta.dirname, '../../../src-tauri/migrations')

/**
 * An in-memory database with the schema built from the same `.sql` files Rust
 * includes at compile time — the tested schema is the shipped schema, not a
 * copy of it.
 */
export async function openTestDatabase(): Promise<{
  driver: SqlDriver
  close: () => void
}> {
  const database = new DatabaseSync(':memory:')

  for (const sql of migrationSql()) {
    database.exec(sql)
  }

  const driver: SqlDriver = {
    async execute(sql, params) {
      database.prepare(sql).run(...(params as never[]))
    },
    async select<Row>(sql: string, params: unknown[]) {
      return database.prepare(sql).all(...(params as never[])) as Row[]
    },
  }

  return { driver, close: () => database.close() }
}

export function migrationSql(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => readFileSync(join(MIGRATIONS_DIR, name), 'utf8'))
}

/** Time is injected, never mocked globally. */
export function fixedClock(instant: string | Date): Clock & {
  set: (next: Date) => void
} {
  let now = new Date(instant)
  return {
    now: () => now,
    set: (next: Date) => {
      now = next
    },
  }
}
