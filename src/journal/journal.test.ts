import { afterEach, describe, expect, it } from 'vitest'
import {
  createJournal,
  decideKeystroke,
  formatJournalDay,
  formatTimeOfDay,
  groupByJournalDay,
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

describe('groupByJournalDay', () => {
  it('gathers Notes under their day, keeping the order they arrive in', async () => {
    const { journal, clock } = await journalAt('2026-03-11T09:00:00')

    await journal.capture('wednesday morning')
    clock.set(local('2026-03-11T15:00:00'))
    await journal.capture('wednesday afternoon')
    clock.set(local('2026-03-13T09:00:00'))
    await journal.capture('friday')

    const groups = groupByJournalDay(
      await journal.notesForFilter({ from: '2026-03-11', to: '2026-03-13' }),
    )

    expect(
      groups.map((group) => [
        group.journalDay,
        group.notes.map((note) => note.body),
      ]),
    ).toEqual([
      ['2026-03-13', ['friday']],
      ['2026-03-11', ['wednesday afternoon', 'wednesday morning']],
    ])
  })

  it('groups nothing into nothing', () => {
    expect(groupByJournalDay([])).toEqual([])
  })
})

describe('formatJournalDay', () => {
  it('reads a Journal Day as the day it names, not the day it parses as', () => {
    // 'YYYY-MM-DD' parses as UTC midnight, which is the previous evening in
    // half the world's timezones; the heading must still say the 13th.
    expect(formatJournalDay('2026-03-13')).toBe('Friday, 13 March 2026')
  })
})

describe('formatTimeOfDay', () => {
  it('reads Captured At as a local time of day', () => {
    // 09:05 UTC is 09:05 in Europe/Lisbon on that date — see vite.config.ts.
    expect(formatTimeOfDay('2026-03-13T09:05:00.000Z')).toBe('09:05')
  })
})

describe('defaultFilter', () => {
  it('opens on the most recent Occupied Day', async () => {
    const { journal, clock } = await journalAt('2026-03-11T09:00:00')

    await journal.capture('wednesday')
    clock.set(local('2026-03-13T09:00:00'))
    await journal.capture('friday')

    expect(await journal.defaultFilter()).toEqual({
      from: '2026-03-13',
      to: '2026-03-13',
    })
  })

  it('skips unoccupied days entirely: a Monday resolves to the previous Friday', async () => {
    const { journal, clock } = await journalAt('2026-03-13T17:00:00')

    await journal.capture('friday, before the weekend')
    // The weekend is empty, and it is now Monday morning.
    clock.set(local('2026-03-16T09:00:00'))

    expect(await journal.defaultFilter()).toEqual({
      from: '2026-03-13',
      to: '2026-03-13',
    })
  })

  it('reaches back however long the gap', async () => {
    const { journal, clock } = await journalAt('2026-02-27T17:00:00')

    await journal.capture('last day before leave')
    clock.set(local('2026-03-16T09:00:00'))

    expect(await journal.defaultFilter()).toEqual({
      from: '2026-02-27',
      to: '2026-02-27',
    })
  })

  it('resolves to nothing on an empty database rather than an arbitrary date', async () => {
    const { journal } = await journalAt('2026-03-16T09:00:00')

    expect(await journal.defaultFilter()).toBeNull()
  })
})

describe('notesForFilter', () => {
  it('returns the newest Note first', async () => {
    const { journal, clock } = await journalAt('2026-03-13T09:00:00')

    await journal.capture('first')
    clock.set(local('2026-03-13T11:00:00'))
    await journal.capture('second')

    const notes = await journal.notesForFilter({
      from: '2026-03-13',
      to: '2026-03-13',
    })

    expect(notes.map((note) => note.body)).toEqual(['second', 'first'])
  })

  it('orders a Filter spanning several days by Journal Day, newest first', async () => {
    const { journal, clock } = await journalAt('2026-03-11T09:00:00')

    await journal.capture('wednesday')
    clock.set(local('2026-03-13T09:00:00'))
    await journal.capture('friday')

    const notes = await journal.notesForFilter({
      from: '2026-03-11',
      to: '2026-03-13',
    })

    expect(notes.map((note) => note.body)).toEqual(['friday', 'wednesday'])
  })

  it('returns nothing for a Filter no Note falls under', async () => {
    const { journal } = await journalAt('2026-03-13T09:00:00')

    await journal.capture('friday')

    expect(
      await journal.notesForFilter({ from: '2026-03-14', to: '2026-03-15' }),
    ).toEqual([])
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
