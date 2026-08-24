import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createJournal,
  rangeForJournalDay,
  type CalendarEvent,
  type Journal,
} from './journal'
import { fixedClock, openTestDatabase } from './testing/database'
import { fakeDesktop, type FakeDesktop } from '../platform/testing/desktop'
import { createAppSettings } from '../settings/app-settings'
import { createImportSession, SWEEP_INTERVAL_MS } from './import-session'

// The sweep is driven end to end here: a real journal over real SQL, a fake
// desktop for the calendar and the settings file, and an injected clock. What
// is asserted is what ended up in the journal, never which query ran.

const openJournals: Array<() => void> = []

afterEach(() => {
  for (const close of openJournals.splice(0)) close()
})

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

/** One event on the calendar. Times are wall clock in the machine's own zone. */
function event(
  overrides: Omit<Partial<CalendarEvent>, 'startsAt' | 'endsAt'> & {
    startsAt: string
    endsAt: string
  },
): CalendarEvent {
  return {
    id: 'event-1',
    calendarId: 'work',
    title: 'Standup',
    isAllDay: false,
    isDeclined: false,
    ...overrides,
    startsAt: new Date(overrides.startsAt).getTime(),
    endsAt: new Date(overrides.endsAt).getTime(),
  }
}

async function importSessionAt(
  instant: string,
  {
    stored = { importMeetings: true, importCalendars: ['work'] },
    access = 'granted' as FakeDesktop['access'],
    events = [] as CalendarEvent[],
  } = {},
) {
  const { driver, close } = await openTestDatabase()
  openJournals.push(close)
  const clock = fixedClock(instant)
  const journal = createJournal({ clock, driver })
  const desktop = fakeDesktop({ driver, stored, access, events })
  const settings = createAppSettings(desktop)
  const session = createImportSession({
    journal: Promise.resolve(journal),
    desktop,
    settings,
    clock,
  })
  return { journal, desktop, clock, session }
}

/** The Bodies filed under one day, oldest first, as a Digest would read them. */
async function bodiesOn(journal: Journal, journalDay: string) {
  const notes = await journal.notesForFilter(rangeForJournalDay(journalDay))
  return notes.map((note) => note.body).reverse()
}

/** Lets a sweep the session started on its own finish before asserting. */
async function flushSweep(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve()
}

describe('the launch sweep', () => {
  it('imports today’s meetings that have already ended', async () => {
    const { journal, session } = await importSessionAt('2026-03-09T18:40:00', {
      events: [
        event({
          title: 'Weekly sync',
          startsAt: '2026-03-09T09:30',
          endsAt: '2026-03-09T10:00',
        }),
        event({
          id: 'event-2',
          title: 'Design review',
          startsAt: '2026-03-09T14:00',
          endsAt: '2026-03-09T15:00',
        }),
      ],
    })

    await session.start()

    expect(await bodiesOn(journal, '2026-03-09')).toEqual([
      'Weekly sync',
      'Design review',
    ])
  })

  it('does nothing at all while Import is off', async () => {
    const { journal, session } = await importSessionAt('2026-03-09T18:40:00', {
      stored: { importMeetings: false, importCalendars: ['work'] },
      events: [
        event({ startsAt: '2026-03-09T09:30', endsAt: '2026-03-09T10:00' }),
      ],
    })

    await session.start()

    expect(await bodiesOn(journal, '2026-03-09')).toEqual([])
  })

  it('sweeps nothing until a calendar is ticked', async () => {
    const { journal, session } = await importSessionAt('2026-03-09T18:40:00', {
      stored: { importMeetings: true, importCalendars: [] },
      events: [
        event({ startsAt: '2026-03-09T09:30', endsAt: '2026-03-09T10:00' }),
      ],
    })

    await session.start()

    expect(await bodiesOn(journal, '2026-03-09')).toEqual([])
  })

  it('lands silently: a sweep is never a Nudge', async () => {
    const { desktop, session } = await importSessionAt('2026-03-09T18:40:00', {
      events: [
        event({ startsAt: '2026-03-09T09:30', endsAt: '2026-03-09T10:00' }),
      ],
    })
    const nudged: string[] = []
    await desktop.onNoteCaptured((journalDay) => nudged.push(journalDay))

    await session.start()

    expect(nudged).toEqual([])
  })

  it('says the journal changed, so an open window and the tray catch up', async () => {
    const { desktop, session } = await importSessionAt('2026-03-09T18:40:00', {
      events: [
        event({ startsAt: '2026-03-09T09:30', endsAt: '2026-03-09T10:00' }),
      ],
    })
    let changed = 0
    await desktop.onJournalChanged(() => (changed += 1))

    await session.start()

    expect(changed).toBe(1)
  })

  it('says nothing when a sweep found nothing to import', async () => {
    const { desktop, session } = await importSessionAt('2026-03-09T18:40:00')
    let changed = 0
    await desktop.onJournalChanged(() => (changed += 1))

    await session.start()

    expect(changed).toBe(0)
  })
})

describe('a sweep without the calendar', () => {
  it('turns Import off when the permission has been revoked', async () => {
    const { desktop, session } = await importSessionAt('2026-03-09T18:40:00', {
      access: 'denied',
    })

    await session.start()

    expect(desktop.stored.importMeetings).toBe(false)
  })

  it('never asks: a background sweep is not a place to raise a prompt', async () => {
    const { desktop, session } = await importSessionAt('2026-03-09T18:40:00', {
      access: 'undetermined',
    })

    await session.start()

    expect(desktop.prompted).toBe(false)
  })

  it('leaves the journal exactly as it was', async () => {
    const { journal, session } = await importSessionAt('2026-03-09T18:40:00', {
      access: 'denied',
    })

    await journal.capture('the migration landed')
    await session.start()

    expect(await bodiesOn(journal, '2026-03-09')).toEqual([
      'the migration landed',
    ])
  })
})

describe('sweeping again', () => {
  it('picks up a meeting that ended since the last look', async () => {
    const { journal, clock, session } = await importSessionAt(
      '2026-03-09T09:45:00',
      {
        events: [
          event({
            title: 'Weekly sync',
            startsAt: '2026-03-09T09:30',
            endsAt: '2026-03-09T10:00',
          }),
        ],
      },
    )

    await session.start()
    expect(await bodiesOn(journal, '2026-03-09')).toEqual([])

    clock.set(new Date('2026-03-09T10:05:00'))
    await vi.advanceTimersByTimeAsync(SWEEP_INTERVAL_MS)
    await flushSweep()

    expect(await bodiesOn(journal, '2026-03-09')).toEqual(['Weekly sync'])
  })

  it('never imports the same meeting twice', async () => {
    const { journal, session } = await importSessionAt('2026-03-09T18:40:00', {
      events: [
        event({ startsAt: '2026-03-09T09:30', endsAt: '2026-03-09T10:00' }),
      ],
    })

    await session.start()
    await vi.advanceTimersByTimeAsync(SWEEP_INTERVAL_MS * 3)
    await flushSweep()

    expect(await bodiesOn(journal, '2026-03-09')).toEqual(['Standup'])
  })

  it('catches up on wake, for what ended while the machine slept', async () => {
    const { journal, desktop, clock, session } = await importSessionAt(
      '2026-03-09T09:00:00',
    )

    await session.start()

    clock.set(new Date('2026-03-09T18:40:00'))
    desktop.events = [
      event({
        title: 'Weekly sync',
        startsAt: '2026-03-09T09:30',
        endsAt: '2026-03-09T10:00',
      }),
    ]
    desktop.wake()
    await flushSweep()

    expect(await bodiesOn(journal, '2026-03-09')).toEqual(['Weekly sync'])
  })

  it('looks again when a Capture begins', async () => {
    const { journal, desktop, clock, session } = await importSessionAt(
      '2026-03-09T09:00:00',
    )

    await session.start()

    clock.set(new Date('2026-03-09T18:40:00'))
    desktop.events = [
      event({
        title: 'Weekly sync',
        startsAt: '2026-03-09T09:30',
        endsAt: '2026-03-09T10:00',
      }),
    ]
    desktop.beginCapture()
    await flushSweep()

    expect(await bodiesOn(journal, '2026-03-09')).toEqual(['Weekly sync'])
  })

  it('looks again the moment Import is turned on', async () => {
    const { journal, desktop, session } = await importSessionAt(
      '2026-03-09T18:40:00',
      {
        stored: { importMeetings: false, importCalendars: ['work'] },
        events: [
          event({
            title: 'Weekly sync',
            startsAt: '2026-03-09T09:30',
            endsAt: '2026-03-09T10:00',
          }),
        ],
      },
    )

    await session.start()
    expect(await bodiesOn(journal, '2026-03-09')).toEqual([])

    await createAppSettings(desktop).saveImportMeetings(true)
    await flushSweep()

    expect(await bodiesOn(journal, '2026-03-09')).toEqual(['Weekly sync'])
  })

  it('stops for good once it is stopped', async () => {
    const { journal, desktop, session } = await importSessionAt(
      '2026-03-09T18:40:00',
    )

    await session.start()
    session.stop()

    desktop.events = [
      event({ startsAt: '2026-03-09T09:30', endsAt: '2026-03-09T10:00' }),
    ]
    desktop.wake()
    await vi.advanceTimersByTimeAsync(SWEEP_INTERVAL_MS * 2)
    await flushSweep()

    expect(await bodiesOn(journal, '2026-03-09')).toEqual([])
  })
})

describe('a meeting the user refused', () => {
  it('stays gone: deleting an Imported Note refuses its meeting for good', async () => {
    const { journal, desktop, session } = await importSessionAt(
      '2026-03-09T18:40:00',
      {
        events: [
          event({ startsAt: '2026-03-09T09:30', endsAt: '2026-03-09T10:00' }),
        ],
      },
    )

    await session.start()
    const [imported] = await journal.notesForFilter(
      rangeForJournalDay('2026-03-09'),
    )
    await journal.delete(imported.id)

    desktop.wake()
    await vi.advanceTimersByTimeAsync(SWEEP_INTERVAL_MS * 2)
    await flushSweep()

    expect(await bodiesOn(journal, '2026-03-09')).toEqual([])
  })
})

describe('a calendar that cannot be read', () => {
  it('leaves the journal working rather than taking it down', async () => {
    const { journal, desktop, session } = await importSessionAt(
      '2026-03-09T18:40:00',
    )
    desktop.todaysCalendarEvents = () => {
      throw new Error('the calendar store is unavailable')
    }

    await expect(session.start()).resolves.toBeUndefined()

    await journal.capture('the migration landed')
    expect(await bodiesOn(journal, '2026-03-09')).toEqual([
      'the migration landed',
    ])
  })
})
