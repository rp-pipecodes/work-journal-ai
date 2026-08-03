/**
 * The one journal the running app uses: the core, wired to the real clock and
 * to the desktop's database. It is the whole of the wiring — every rule and
 * every SQL statement stays in `journal.ts`.
 */

import type { Desktop } from '@/platform/desktop'
import { createJournal, type Clock, type Journal } from './journal'

export async function createAppJournal({
  desktop,
  clock = { now: () => new Date() },
}: {
  desktop: Desktop
  clock?: Clock
}): Promise<Journal> {
  const driver = await desktop.openJournalDatabase()
  return createJournal({ clock, driver })
}
