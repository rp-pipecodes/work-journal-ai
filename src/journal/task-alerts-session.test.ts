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

  it('holds one pending request for a Recurring Task, and replaces it', async () => {
    const { session, journal, desktop, clock } = await sessionAt(
      '2026-03-16T08:00:00',
    )
    const task = await journal.createTask(
      'stand-up',
      { date: '2026-03-16', time: '09:00' },
      { unit: 'day', interval: 1, weekdays: [] },
    )

    await session.start()

    expect(desktop.pendingAlerts).toHaveLength(1)
    expect(desktop.pendingAlerts[0]).toMatchObject({
      id: `task:${task.id}`,
      day: 16,
      hour: 9,
    })

    // Completing advances the series. The successor claims the same
    // identifier, so macOS is left holding one request, not two.
    clock.set(new Date('2026-03-16T09:30:00'))
    await journal.completeTask(task.id)
    await desktop.announceTasksChanged()
    await vi.advanceTimersByTimeAsync(0)

    expect(desktop.pendingAlerts).toHaveLength(1)
    expect(desktop.pendingAlerts[0]).toMatchObject({
      id: `task:${task.id}`,
      day: 17,
      hour: 9,
    })
  })

  it('never pre-registers the slots a Recurring Task has not reached', async () => {
    const { session, journal, desktop } = await sessionAt('2026-03-16T08:00:00')
    await journal.createTask(
      'gym',
      { date: '2026-03-16', time: '18:00' },
      { unit: 'week', interval: 1, weekdays: [1, 3, 5] },
    )

    await session.start()

    expect(desktop.pendingAlerts).toHaveLength(1)
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

  it('completes the Task a Complete action names', async () => {
    const { session, journal, desktop } = await sessionAt('2026-03-16T10:00:00')
    const task = await journal.createTask('ahead', {
      date: '2026-03-16',
      time: '17:00',
    })
    await session.start()

    desktop.completeTaskAlert({
      taskId: `task:${task.id}`,
      date: '2026-03-16',
      time: '17:00',
    })
    await vi.advanceTimersByTimeAsync(0)

    expect(await journal.openTasks()).toEqual([])
    // A success opens nothing: there is nothing to review.
    expect(desktop.pendingTaskAlert).toBeNull()
    expect(pending(desktop)).toEqual([])
  })

  it('advances a Recurring Task from its Alert', async () => {
    const { session, journal, desktop } = await sessionAt('2026-03-16T10:00:00')
    const task = await journal.createTask(
      'stand-up',
      { date: '2026-03-16', time: '09:00' },
      { unit: 'day', interval: 1, weekdays: [] },
    )
    await session.start()

    desktop.completeTaskAlert({
      taskId: `task:${task.id}`,
      date: '2026-03-16',
      time: '09:00',
    })
    await vi.advanceTimersByTimeAsync(0)

    expect(await journal.openTasks()).toEqual([
      expect.objectContaining({
        id: task.id,
        scheduledDate: '2026-03-17',
        scheduledTime: '09:00',
      }),
    ])
    expect(desktop.pendingAlerts).toHaveLength(1)
    expect(desktop.pendingAlerts[0]).toMatchObject({ day: 17, hour: 9 })
  })

  it('opens the Task for review when its slot moved under the banner', async () => {
    const { session, journal, desktop } = await sessionAt('2026-03-16T10:00:00')
    const task = await journal.createTask('ahead', {
      date: '2026-03-16',
      time: '17:00',
    })
    await session.start()

    // Rescheduled since the banner was delivered.
    await journal.editTask(task.id, {
      description: task.description,
      schedule: { date: '2026-03-18', time: '09:30' },
    })
    desktop.completeTaskAlert({
      taskId: `task:${task.id}`,
      date: '2026-03-16',
      time: '17:00',
    })
    await vi.advanceTimersByTimeAsync(0)

    // No mutation: still open at the new slot.
    expect(await journal.openTasks()).toEqual([
      expect.objectContaining({
        id: task.id,
        scheduledDate: '2026-03-18',
        scheduledTime: '09:30',
      }),
    ])
    // Opened for review instead.
    expect(desktop.pendingTaskAlert).toBe(`task:${task.id}`)
  })

  it('claims no review when the Task is gone', async () => {
    const { session, journal, desktop } = await sessionAt('2026-03-16T10:00:00')
    const task = await journal.createTask('ahead', {
      date: '2026-03-16',
      time: '17:00',
    })
    await session.start()
    await journal.deleteTask(task.id)

    desktop.completeTaskAlert({
      taskId: `task:${task.id}`,
      date: '2026-03-16',
      time: '17:00',
    })
    await vi.advanceTimersByTimeAsync(0)

    expect(await journal.openTasks()).toEqual([])
    expect(desktop.pendingTaskAlert).toBeNull()
  })

  it('processes one Complete delivered twice only once', async () => {
    const { session, journal, desktop } = await sessionAt('2026-03-16T10:00:00')
    const task = await journal.createTask('ahead', {
      date: '2026-03-16',
      time: '17:00',
    })
    await session.start()

    const response = {
      taskId: `task:${task.id}`,
      date: '2026-03-16',
      time: '17:00',
    }
    desktop.completeTaskAlert(response)
    desktop.completeTaskAlert(response)
    await vi.advanceTimersByTimeAsync(0)

    expect(await journal.openTasks()).toEqual([])
    // Without the guard the second delivery would read as stale and open the
    // Task for a review nobody asked for.
    expect(desktop.pendingTaskAlert).toBeNull()
  })

  it('claims a Complete chosen while the app was not running', async () => {
    const { session, journal, desktop } = await sessionAt('2026-03-16T10:00:00')
    const task = await journal.createTask('ahead', {
      date: '2026-03-16',
      time: '17:00',
    })

    // Chosen before the session was listening: taken at start, exactly once.
    desktop.completeTaskAlert({
      taskId: `task:${task.id}`,
      date: '2026-03-16',
      time: '17:00',
    })
    await session.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(await journal.openTasks()).toEqual([])
    expect(await desktop.completedTaskAlert()).toBeNull()
  })

  it('leaves the Task alone when the guarded completion fails', async () => {
    const { session, journal, desktop } = await sessionAt('2026-03-16T10:00:00')
    const task = await journal.createTask('ahead', {
      date: '2026-03-16',
      time: '17:00',
    })
    await session.start()
    vi.spyOn(journal, 'completeTaskAt').mockRejectedValueOnce(
      new Error('the journal could not be written'),
    )

    desktop.completeTaskAlert({
      taskId: `task:${task.id}`,
      date: '2026-03-16',
      time: '17:00',
    })
    await vi.advanceTimersByTimeAsync(0)

    expect(await journal.openTasks()).toEqual([
      expect.objectContaining({ id: task.id }),
    ])
    expect(desktop.pendingTaskAlert).toBeNull()
  })

  it('hears no Complete once it is stopped', async () => {
    const { session, journal, desktop } = await sessionAt('2026-03-16T10:00:00')
    const task = await journal.createTask('ahead', {
      date: '2026-03-16',
      time: '17:00',
    })
    await session.start()
    session.stop()

    desktop.completeTaskAlert({
      taskId: `task:${task.id}`,
      date: '2026-03-16',
      time: '17:00',
    })
    await vi.advanceTimersByTimeAsync(0)

    expect(await journal.openTasks()).toEqual([
      expect.objectContaining({ id: task.id }),
    ])
  })
})
