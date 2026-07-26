import { afterEach, describe, expect, it } from 'vitest'
import {
  createJournal,
  decideKeystroke,
  journalDayFor,
  DEFAULT_DAY_START_HOUR,
} from './journal'
import { fixedClock, openTestDatabase } from './testing/database'

// Every test drives the core through its public operations and asserts on what
// comes back out. Nothing here asserts that a particular query ran.

const openJournals: Array<() => void> = []

afterEach(() => {
  for (const close of openJournals.splice(0)) {
    close()
  }
})

async function journalAt(instant: string) {
  const { driver, close } = await openTestDatabase()
  openJournals.push(close)
  const clock = fixedClock(instant)
  return { journal: createJournal({ clock, driver }), clock }
}

describe('journalDayFor', () => {
  it('files a Note captured before the Day Start under the previous day', () => {
    expect(journalDayFor(local('2026-03-12T00:45:00'), 4)).toBe('2026-03-11')
  })

  it('puts 03:59 and 04:00 either side of the boundary', () => {
    expect(journalDayFor(local('2026-03-12T03:59:59'), 4)).toBe('2026-03-11')
    expect(journalDayFor(local('2026-03-12T04:00:00'), 4)).toBe('2026-03-12')
  })

  it('moves the boundary with a custom Day Start', () => {
    expect(journalDayFor(local('2026-03-12T03:59:59'), 0)).toBe('2026-03-12')
    expect(journalDayFor(local('2026-03-12T05:00:00'), 6)).toBe('2026-03-11')
  })

  it('resolves a day spanning a DST transition to exactly one day', () => {
    // Europe/Lisbon springs forward at 01:00 on 2026-03-29 — see vite.config.ts
    // for why the suite pins the timezone.
    const acrossTheTransition = [
      '2026-03-29T04:00:00',
      '2026-03-29T12:00:00',
      '2026-03-29T23:59:59',
      '2026-03-30T03:00:00',
    ].map((wallClock) => journalDayFor(local(wallClock), DEFAULT_DAY_START_HOUR))

    expect(new Set(acrossTheTransition)).toEqual(new Set(['2026-03-29']))
  })
})

describe('decideKeystroke', () => {
  it('commits on Enter with text', () => {
    expect(decideKeystroke('Enter', 'shipped the tray menu')).toBe('commit')
  })

  it('ignores Enter on empty or whitespace-only text', () => {
    expect(decideKeystroke('Enter', '')).toBe('ignore')
    expect(decideKeystroke('Enter', '   \t ')).toBe('ignore')
  })

  it('discards on Escape, whatever has been typed', () => {
    expect(decideKeystroke('Escape', 'half a thought')).toBe('discard')
    expect(decideKeystroke('Escape', '')).toBe('discard')
  })

  it('neither commits nor discards on an ordinary key', () => {
    expect(decideKeystroke('a', 'a')).toBe('ignore')
    expect(decideKeystroke('Tab', 'something')).toBe('ignore')
  })
})

describe('capture', () => {
  it('reads a committed Note back with its Body intact', async () => {
    const { journal } = await journalAt('2026-03-12T09:30:00')

    const captured = await journal.capture('rewrote the digest grouping')

    expect(captured?.body).toBe('rewrote the digest grouping')
    const stored = await journal.notesForJournalDay('2026-03-12')
    expect(stored.map((note) => note.body)).toEqual([
      'rewrote the digest grouping',
    ])
  })

  it('trims surrounding whitespace from the Body', async () => {
    const { journal } = await journalAt('2026-03-12T09:30:00')

    const captured = await journal.capture('  paired on the migration  ')

    expect(captured?.body).toBe('paired on the migration')
  })

  it('commits nothing for empty or whitespace-only input', async () => {
    const { journal } = await journalAt('2026-03-12T09:30:00')

    expect(await journal.capture('')).toBeNull()
    expect(await journal.capture('   \t ')).toBeNull()
    expect(await journal.notesForJournalDay('2026-03-12')).toEqual([])
  })

  it('refuses a Body containing a line break', async () => {
    const { journal } = await journalAt('2026-03-12T09:30:00')

    await expect(journal.capture('one line\nand another')).rejects.toThrow(
      /line break/i,
    )
  })

  it('records Captured At as UTC', async () => {
    const { journal } = await journalAt('2026-03-12T09:30:00')

    const captured = await journal.capture('checked the clock')

    // 09:30 in Europe/Lisbon on that date is 09:30 UTC — see vite.config.ts.
    expect(captured?.capturedAt).toBe('2026-03-12T09:30:00.000Z')
  })

  it('files a Note captured at 00:45 under the previous Journal Day', async () => {
    const { journal } = await journalAt('2026-03-12T00:45:00')

    const captured = await journal.capture('still debugging the tray')

    expect(captured?.journalDay).toBe('2026-03-11')
    expect(await journal.notesForJournalDay('2026-03-12')).toEqual([])
    expect((await journal.notesForJournalDay('2026-03-11')).length).toBe(1)
  })

  it('gives a fresh Note no Edited At', async () => {
    const { journal } = await journalAt('2026-03-12T09:30:00')

    const captured = await journal.capture('untouched since capture')

    expect(captured?.editedAt).toBeNull()
  })

  it('gives each Note its own identity', async () => {
    const { journal } = await journalAt('2026-03-12T09:30:00')

    const first = await journal.capture('the same words')
    const second = await journal.capture('the same words')

    expect(first?.id).not.toBe(second?.id)
  })
})

describe('notesForJournalDay', () => {
  it('returns the oldest Note first', async () => {
    const { journal, clock } = await journalAt('2026-03-12T09:00:00')

    await journal.capture('first')
    clock.set(local('2026-03-12T11:00:00'))
    await journal.capture('second')

    const notes = await journal.notesForJournalDay('2026-03-12')

    expect(notes.map((note) => note.body)).toEqual(['first', 'second'])
  })

  it('returns nothing for a day with no Notes', async () => {
    const { journal } = await journalAt('2026-03-12T09:00:00')

    expect(await journal.notesForJournalDay('2026-03-11')).toEqual([])
  })
})

/**
 * The instant at which the suite's pinned timezone read this wall-clock time.
 * A date-time literal carrying no offset is parsed as local time, which is the
 * whole point here — these tests are about a local-calendar decision.
 */
function local(wallClock: string): Date {
  return new Date(wallClock)
}
