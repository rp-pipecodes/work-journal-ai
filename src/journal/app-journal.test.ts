import { afterEach, describe, expect, it } from 'vitest'
import { fakeDesktop } from '../platform/testing/desktop'
import { createAppJournal } from './app-journal'
import { filterForJournalDay } from './journal'
import { fixedClock, openTestDatabase } from './testing/database'

// The wiring the running app uses, driven over a real database: the core and
// the desktop's storage.

const openDatabases: Array<() => void> = []

afterEach(() => {
  for (const close of openDatabases.splice(0)) {
    close()
  }
})

describe('the app journal', () => {
  it('captures a Note into the desktop database', async () => {
    const journal = await appJournalOver({})

    const note = await journal.capture('Shipped the thing')

    expect(note?.body).toBe('Shipped the thing')
    expect(
      await journal.notesForFilter(filterForJournalDay(note!.journalDay)),
    ).toHaveLength(1)
  })

  it('files a Capture after midnight under the local calendar day', async () => {
    const journal = await appJournalOver({ at: '2026-03-10T02:00:00' })

    const note = await journal.capture('Late one')

    expect(note?.journalDay).toBe('2026-03-10')
  })
})

async function appJournalOver({
  at = '2026-03-10T10:00:00',
}: {
  at?: string
}) {
  const { driver, close } = await openTestDatabase()
  openDatabases.push(close)

  const desktop = fakeDesktop({ driver })

  return createAppJournal({
    desktop,
    clock: fixedClock(at),
  })
}
