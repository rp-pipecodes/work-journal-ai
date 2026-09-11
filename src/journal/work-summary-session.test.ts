import { describe, expect, it, vi } from 'vitest'
import type { Journal } from './journal'
import { fixedClock } from './testing/database'
import { fakeDesktop } from '../platform/testing/desktop'
import { createWorkSummarySession } from './work-summary-session'

describe('Work Summary session startup', () => {
  it('stops every subscription across a start-stop-start lifecycle', async () => {
    const desktop = fakeDesktop()
    const installed: Array<() => void> = []
    const pendingStops: Array<(stop: () => void) => void> = []
    let stopped = 0

    function subscribe(handle: () => void): Promise<() => void> {
      installed.push(handle)
      return new Promise((resolve) => pendingStops.push(resolve))
    }

    desktop.onJournalChanged = subscribe
    desktop.onTasksChanged = subscribe
    desktop.onWindowFocused = subscribe
    desktop.onSystemWoke = subscribe

    const session = createWorkSummarySession({
      journal: Promise.resolve({
        notesForFilter: async () => [],
        completedTasks: async () => [],
        occurrencesKeptIn: async () => [],
        openTasks: async () => [],
      } as unknown as Journal),
      desktop,
      clock: fixedClock('2026-03-12T09:00:00'),
      range: { from: '2026-03-09', to: '2026-03-12' },
      onChange: vi.fn(),
    })

    const firstStart = session.start()
    expect(installed).toHaveLength(4)

    session.stop()
    const secondStart = session.start()
    expect(installed).toHaveLength(8)

    for (const resolve of pendingStops) {
      resolve(() => {
        stopped += 1
      })
    }

    await Promise.all([firstStart, secondStart])
    session.stop()

    expect(stopped).toBe(8)
  })
})
