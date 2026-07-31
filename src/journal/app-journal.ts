/**
 * The one journal the running app uses: the core, wired to the real clock and
 * to the desktop's database. It is the whole of the wiring — every rule and
 * every SQL statement stays in `journal.ts`.
 */

import type { Desktop } from '@/platform/desktop'
import { createJournal, type Clock, type DayStart, type Journal } from './journal'

export async function createAppJournal({
  desktop,
  dayStart,
  clock = { now: () => new Date() },
}: {
  desktop: Desktop
  /**
   * Handed in, so the composition root owns where the Day Start comes from.
   * Awaited rather than held: the journal is not ready until the Day Start it
   * will file under is known, or no Capture made during startup could be
   * trusted to land on the right day.
   */
  dayStart: Promise<DayStart>
  clock?: Clock
}): Promise<Journal> {
  // Both at once: opening a database and reading a settings file have nothing
  // to say to each other.
  const [driver, hours] = await Promise.all([
    desktop.openJournalDatabase(),
    dayStart,
  ])

  return createJournal({ clock, driver, dayStart: hours })
}
