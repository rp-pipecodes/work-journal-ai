import { afterEach, describe, expect, it } from 'vitest'
import { fakeDesktop } from '../platform/testing/desktop'
import { createAppSettings, followDayStart } from '../settings/app-settings'
import { createAppJournal } from './app-journal'
import { fixedClock, openTestDatabase } from './testing/database'

// The wiring the running app uses, driven over a real database: the core,
// the desktop's storage, and a Day Start that follows the settings.

const openDatabases: Array<() => void> = []

afterEach(() => {
  for (const close of openDatabases.splice(0)) {
    close()
  }
})

describe('the app journal', () => {
  it('captures a Note into the desktop database', async () => {
    const { journal } = await appJournalOver({})

    const note = await journal.capture('Shipped the thing')

    expect(note?.body).toBe('Shipped the thing')
    expect(await journal.notesForJournalDay(note!.journalDay)).toHaveLength(1)
  })

  it('files under the stored Day Start from the very first Capture', async () => {
    // 02:00 is still the previous day when a day begins at 06:00. The journal
    // is not ready until the stored hour is known, so this needs no waiting.
    const { journal } = await appJournalOver({
      stored: { dayStartHour: 6 },
      at: '2026-03-10T02:00:00',
    })

    const note = await journal.capture('Late one')

    expect(note?.journalDay).toBe('2026-03-09')
  })

  it('files under a Day Start another window has just changed', async () => {
    const { journal, desktop } = await appJournalOver({
      stored: { dayStartHour: 6 },
      at: '2026-03-10T02:00:00',
    })

    await desktop.announceDayStart(0)
    const note = await journal.capture('Past midnight')

    expect(note?.journalDay).toBe('2026-03-10')
  })
})

async function appJournalOver({
  stored = {},
  at = '2026-03-10T10:00:00',
}: {
  stored?: Record<string, unknown>
  at?: string
}) {
  const { driver, close } = await openTestDatabase()
  openDatabases.push(close)

  const desktop = fakeDesktop({ driver, stored })

  const journal = await createAppJournal({
    desktop,
    dayStart: followDayStart(createAppSettings(desktop)),
    clock: fixedClock(at),
  })

  return { journal, desktop }
}
