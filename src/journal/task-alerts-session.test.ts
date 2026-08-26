import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createJournal, type Journal } from './journal'
import { fixedClock, openTestDatabase } from './testing/database'
import { fakeDesktop, type FakeDesktop } from '../platform/testing/desktop'
import {
  createTaskAlertsSession,
  RECONCILE_INTERVAL_MS,
} from './task-alerts-session'

// Reconciliation is driven end to end here: a real journal over real SQL, a
// fake desktop for the OS's pending requests, and an injected clock. What is
// asserted is what macOS was left holding, never which call was made to get
// there.

const openJournals: Array<() => void> = []
const sessions: Array<() => void> = []

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  for (const stop of sessions.splice(0)) stop()
  vi.useRealTimers()
  for (const close of openJournals.splice(0)) close()
})

async function sessionAt(
  instant: string,
  { alertPermission = 'granted' as FakeDesktop['alertPermission'] } = {},
) {
  const { driver, close } = await openTestDatabase()
  openJournals.push(close)
  const clock = fixedClock(instant)
  const desktop = fakeDesktop({ driver, alertPermission })
  const journal: Journal = createJournal({ clock, driver })
  const session = createTaskAlertsSession({
    journal: Promise.resolve(journal),
    desktop,
    clock,
  })
  sessions.push(() => session.stop())

  return { session, journal, desktop, clock }
}

function pending(desktop: FakeDesktop): string[] {
  return desktop.pendingAlerts.map((alert) => alert.description)
}

describe('createTaskAlertsSession', () => {
  it('registers every future timed Open Task on launch', async () => {
    const { session, journal, desktop } = await sessionAt('2026-03-16T10:00:00')
    await journal.createTask('ahead', { date: '2026-03-16', time: '17:00' })
    await journal.createTask('date only', { date: '2026-03-16', time: null })
    await journal.createTask('gone', { date: '2026-03-16', time: '08:00' })
    await journal.createTask('unscheduled')

    await session.start()

    expect(pending(desktop)).toEqual(['ahead'])
  })

  it('never replays a Task Alert whose moment has passed', async () => {
    const { session, journal, desktop, clock } = await sessionAt(
      '2026-03-16T10:00:00',
    )
    await journal.createTask('ahead', { date: '2026-03-16', time: '17:00' })

    clock.set(new Date('2026-03-16T18:00:00'))
    await session.start()

    expect(pending(desktop)).toEqual([])
  })

  it('registers nothing at all while the permission is not granted', async () => {
    const { session, journal, desktop } = await sessionAt(
      '2026-03-16T10:00:00',
      { alertPermission: 'denied' },
    )
    await journal.createTask('ahead', { date: '2026-03-16', time: '17:00' })

    await session.start()

    expect(desktop.reconciliations).toEqual([])
    expect(pending(desktop)).toEqual([])
  })

  it('never prompts of its own accord', async () => {
    const { session, desktop } = await sessionAt('2026-03-16T10:00:00', {
      alertPermission: 'undetermined',
    })

    await session.start()

    expect(desktop.alertPrompted).toBe(false)
  })

  it('registers the Tasks still ahead once the permission is restored', async () => {
    const { session, journal, desktop } = await sessionAt(
      '2026-03-16T10:00:00',
      { alertPermission: 'denied' },
    )
    await journal.createTask('ahead', { date: '2026-03-16', time: '17:00' })
    await journal.createTask('gone', { date: '2026-03-16', time: '08:00' })
    await session.start()

    desktop.alertPermission = 'granted'
    await vi.advanceTimersByTimeAsync(RECONCILE_INTERVAL_MS)

    expect(pending(desktop)).toEqual(['ahead'])
  })

  it('reconciles again whenever the Tasks change', async () => {
    const { session, journal, desktop } = await sessionAt('2026-03-16T10:00:00')
    await session.start()

    await journal.createTask('ahead', { date: '2026-03-16', time: '17:00' })
    await desktop.announceTasksChanged()
    await vi.advanceTimersByTimeAsync(0)

    expect(pending(desktop)).toEqual(['ahead'])
  })

  it('gives up the request of a Task that was completed', async () => {
    const { session, journal, desktop } = await sessionAt('2026-03-16T10:00:00')
    const task = await journal.createTask('ahead', {
      date: '2026-03-16',
      time: '17:00',
    })
    await session.start()

    await journal.completeTask(task.id)
    await desktop.announceTasksChanged()
    await vi.advanceTimersByTimeAsync(0)

    expect(pending(desktop)).toEqual([])
  })

  it('gives up the request of a Task that was deleted', async () => {
    const { session, journal, desktop } = await sessionAt('2026-03-16T10:00:00')
    const task = await journal.createTask('ahead', {
      date: '2026-03-16',
      time: '17:00',
    })
    await session.start()

    await journal.deleteTask(task.id)
    await desktop.announceTasksChanged()
    await vi.advanceTimersByTimeAsync(0)

    expect(pending(desktop)).toEqual([])
  })

  it('moves the request when the schedule moves, keeping the identifier', async () => {
    const { session, journal, desktop } = await sessionAt('2026-03-16T10:00:00')
    const task = await journal.createTask('ahead', {
      date: '2026-03-16',
      time: '17:00',
    })
    await session.start()
    const [before] = desktop.pendingAlerts

    await journal.editTask(task.id, {
      description: task.description,
      schedule: { date: '2026-03-18', time: '09:30' },
    })
    await desktop.announceTasksChanged()
    await vi.advanceTimersByTimeAsync(0)
    const [after] = desktop.pendingAlerts

    expect(after.id).toBe(before.id)
    expect(after).toMatchObject({ day: 18, hour: 9, minute: 30 })
  })

  it('reconciles again when the machine wakes', async () => {
    const { session, journal, desktop } = await sessionAt('2026-03-16T10:00:00')
    await session.start()
    await journal.createTask('ahead', { date: '2026-03-16', time: '17:00' })

    desktop.wake()
    await vi.advanceTimersByTimeAsync(0)

    expect(pending(desktop)).toEqual(['ahead'])
  })

  it('leaves the Tasks alone when the OS refuses', async () => {
    const { session, journal, desktop } = await sessionAt('2026-03-16T10:00:00')
    const task = await journal.createTask('ahead', {
      date: '2026-03-16',
      time: '17:00',
    })
    desktop.alertsFail = true

    await session.start()

    expect(await journal.openTasks()).toEqual([
      expect.objectContaining({ id: task.id, scheduledTime: '17:00' }),
    ])
  })

  it('asks again for a change that landed while it was reconciling', async () => {
    const { session, journal, desktop } = await sessionAt('2026-03-16T10:00:00')
    await session.start()

    // The OS held mid-reconciliation, so a second change lands while the first
    // run has already read the journal — the case a dropped trigger loses.
    const reconcile = desktop.reconcileTaskAlerts.bind(desktop)
    let release = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    desktop.reconcileTaskAlerts = async (alerts) => {
      await held
      await reconcile(alerts)
    }

    await journal.createTask('first', { date: '2026-03-16', time: '17:00' })
    await desktop.announceTasksChanged()
    await vi.advanceTimersByTimeAsync(0)

    await journal.createTask('second', { date: '2026-03-16', time: '18:00' })
    await desktop.announceTasksChanged()
    await vi.advanceTimersByTimeAsync(0)

    release()
    await vi.advanceTimersByTimeAsync(0)

    expect(pending(desktop).sort()).toEqual(['first', 'second'])
  })

  it('says so when the OS would not hold what the journal asked', async () => {
    const { session, journal, desktop } = await sessionAt('2026-03-16T10:00:00')
    const outcomes: boolean[] = []
    await desktop.onTaskAlertsReconciled((held) => outcomes.push(held))
    await journal.createTask('ahead', { date: '2026-03-16', time: '17:00' })
    desktop.alertsFail = true

    await session.start()

    expect(outcomes).toEqual([false])
  })

  it('says so again once the OS takes them after all', async () => {
    const { session, journal, desktop } = await sessionAt('2026-03-16T10:00:00')
    const outcomes: boolean[] = []
    await desktop.onTaskAlertsReconciled((held) => outcomes.push(held))
    await journal.createTask('ahead', { date: '2026-03-16', time: '17:00' })
    desktop.alertsFail = true
    await session.start()

    desktop.alertsFail = false
    desktop.wake()
    await vi.advanceTimersByTimeAsync(0)

    expect(outcomes).toEqual([false, true])
  })

  it('stops asking once it is stopped', async () => {
    const { session, journal, desktop } = await sessionAt('2026-03-16T10:00:00')
    await session.start()
    const asked = desktop.reconciliations.length

    session.stop()
    await journal.createTask('ahead', { date: '2026-03-16', time: '17:00' })
    await desktop.announceTasksChanged()
    await vi.advanceTimersByTimeAsync(RECONCILE_INTERVAL_MS)

    expect(desktop.reconciliations).toHaveLength(asked)
  })
})
