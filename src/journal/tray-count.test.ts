import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createJournal, type Journal } from './journal'
import { fixedClock, openTestDatabase } from './testing/database'
import { fakeDesktop, type FakeDesktop } from '../platform/testing/desktop'
import { createTrayCount } from './tray-count'

// The tray count is driven end to end here: a real journal over real SQL, a
// fake desktop for the glyph, and an injected clock for the rollover. Nothing
// asserts which query ran — only what the menu bar ends up showing.

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

async function trayCountAt(instant: string) {
  const { driver, close } = await openTestDatabase()
  openJournals.push(close)
  const clock = fixedClock(instant)
  const journal = createJournal({ clock, driver })
  const desktop = fakeDesktop()
  const tray = createTrayCount({
    journal: Promise.resolve(journal),
    desktop,
    clock,
  })
  return { journal, desktop, clock, tray }
}

/**
 * Lets a refresh the tray started on its own finish before asserting. A refresh
 * is a chain of awaits and no timer, so with the fake clock installed there is
 * nothing to advance — only microtasks to let through.
 */
async function flushReads(): Promise<void> {
  for (let turn = 0; turn < 10; turn += 1) await Promise.resolve()
}

/**
 * A journal whose counts are held open, so a test can decide which of two
 * overlapping reads comes back first.
 */
function deferredCounts() {
  const pending: Array<(count: number) => void> = []
  return {
    journal: {
      capturedNoteCount: () =>
        new Promise<number>((resolve) => pending.push(resolve)),
    } as unknown as Journal,
    settleOldest: (count: number) => pending.shift()?.(count),
    settleNewest: (count: number) => pending.pop()?.(count),
  }
}

/** What the menu bar is showing right now. */
function showing(desktop: FakeDesktop): string | null {
  return desktop.trayTitle
}

describe('the tray count', () => {
  it('shows the count for today as soon as it starts', async () => {
    const { journal, desktop, tray } = await trayCountAt('2026-03-12T09:00:00')

    await journal.capture('the migration landed')
    await journal.capture('took the on-call handover')
    await tray.start()

    expect(showing(desktop)).toBe('2')
  })

  it('shows a day nothing has been written on as more than a smaller number', async () => {
    const { desktop, tray } = await trayCountAt('2026-03-12T09:00:00')

    await tray.start()

    expect(showing(desktop)).not.toBe('0')
    expect(showing(desktop)).toBe('–')
  })

  it('counts only today, not the days before it', async () => {
    const { journal, desktop, clock, tray } = await trayCountAt(
      '2026-03-11T09:00:00',
    )

    await journal.capture('the migration landed')
    clock.set(new Date('2026-03-12T09:00:00'))
    await tray.start()

    expect(showing(desktop)).toBe('–')
  })

  it('rises as Notes are captured', async () => {
    const { journal, desktop, tray } = await trayCountAt('2026-03-12T09:00:00')
    await tray.start()

    await journal.capture('the migration landed')
    await desktop.announceJournalChanged()
    await flushReads()

    expect(showing(desktop)).toBe('1')
  })

  it('falls as Notes are deleted, back to a day with nothing on it', async () => {
    const { journal, desktop, tray } = await trayCountAt('2026-03-12T09:00:00')
    const note = await journal.capture('the migration landed')
    await tray.start()
    expect(showing(desktop)).toBe('1')

    await journal.delete(note!.id)
    await desktop.announceJournalChanged()
    await flushReads()

    expect(showing(desktop)).toBe('–')
  })

  it('starts the next day at nothing when the day turns over', async () => {
    const { journal, desktop, clock, tray } = await trayCountAt(
      '2026-03-12T23:59:59',
    )
    await journal.capture('the migration landed')
    await tray.start()
    expect(showing(desktop)).toBe('1')

    clock.set(new Date('2026-03-13T00:00:00'))
    await vi.advanceTimersByTimeAsync(1_000)

    expect(showing(desktop)).toBe('–')
  })

  it('keeps rolling over, day after day', async () => {
    const { journal, desktop, clock, tray } = await trayCountAt(
      '2026-03-12T23:59:59',
    )
    await tray.start()

    clock.set(new Date('2026-03-13T00:00:00'))
    await vi.advanceTimersByTimeAsync(1_000)
    await journal.capture('took the on-call handover')
    await desktop.announceJournalChanged()
    await flushReads()
    expect(showing(desktop)).toBe('1')

    clock.set(new Date('2026-03-14T00:00:00'))
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000)

    expect(showing(desktop)).toBe('–')
  })

  it('catches up a day that turned over while the machine was asleep', async () => {
    const { journal, desktop, clock, tray } = await trayCountAt(
      '2026-03-12T22:00:00',
    )
    await journal.capture('the migration landed')
    await tray.start()
    expect(showing(desktop)).toBe('1')

    // The webview behind this is hidden for its whole life, so its timers are
    // throttled and coalesced: the machine sleeps through midnight and the
    // rollover does not fire on time. Beginning a Capture is the moment it
    // matters most that the glyph is not still claiming yesterday's total.
    clock.set(new Date('2026-03-13T09:00:00'))
    desktop.beginCapture()
    await flushReads()

    expect(showing(desktop)).toBe('–')
  })

  it('shows the last read to land, not the last one asked for', async () => {
    const { desktop } = await trayCountAt('2026-03-12T09:00:00')
    const counts = deferredCounts()
    const tray = createTrayCount({
      journal: Promise.resolve(counts.journal),
      desktop,
      clock: fixedClock('2026-03-12T09:00:00'),
    })

    const started = tray.start()
    await flushReads()
    // Two reads in flight at once — a rollover and a change, say — and the
    // older one comes back last.
    await desktop.announceJournalChanged()
    await flushReads()
    counts.settleNewest(4)
    counts.settleOldest(1)
    await started
    await flushReads()

    expect(showing(desktop)).toBe('4')
  })

  it('says nothing more once it is stopped', async () => {
    const { journal, desktop, tray } = await trayCountAt('2026-03-12T09:00:00')
    await tray.start()
    tray.stop()

    await journal.capture('the migration landed')
    await desktop.announceJournalChanged()
    await vi.advanceTimersByTimeAsync(48 * 60 * 60 * 1000)

    expect(showing(desktop)).toBe('–')
  })

  it('leaves the glyph as it was when the journal cannot be read', async () => {
    const { journal, desktop, tray } = await trayCountAt('2026-03-12T09:00:00')
    await journal.capture('the migration landed')
    await tray.start()
    expect(showing(desktop)).toBe('1')

    const unreadable: Journal = {
      ...journal,
      capturedNoteCount: () => Promise.reject(new Error('no database')),
    }
    const failing = createTrayCount({
      journal: Promise.resolve(unreadable),
      desktop,
      clock: fixedClock('2026-03-12T09:00:00'),
    })
    await failing.start()

    expect(showing(desktop)).toBe('1')
  })
})
