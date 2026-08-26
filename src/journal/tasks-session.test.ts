import { afterEach, describe, expect, it, vi } from 'vitest'
import { createJournal, type Journal, type Task } from './journal'
import {
  createTasksSession,
  openingTasksSnapshot,
  type TasksSession,
  type TasksSnapshot,
} from './tasks-session'
import { fixedClock, openTestDatabase } from './testing/database'
import { ALERT_REFUSED } from './task-alerts'
import { fakeDesktop, type FakeDesktop } from '../platform/testing/desktop'

// Every test drives a real journal over real SQL. Nothing here asserts that a
// particular query ran.

const openDatabases: Array<() => void> = []

afterEach(() => {
  for (const close of openDatabases.splice(0)) close()
})

async function tasksSession(
  descriptions: string[] = [],
  { alertPermission = 'granted' as FakeDesktop['alertPermission'] } = {},
) {
  const { driver, close } = await openTestDatabase()
  openDatabases.push(close)

  const clock = fixedClock('2026-03-09T09:00:00')
  const core = createJournal({ clock, driver })

  const created: Task[] = []
  for (const [index, description] of descriptions.entries()) {
    clock.set(new Date(`2026-03-09T${String(9 + index).padStart(2, '0')}:00:00`))
    created.push(await core.createTask(description))
  }

  let snapshot: TasksSnapshot = openingTasksSnapshot
  const announced: number[] = []
  const desktop = fakeDesktop({ driver, alertPermission })
  void desktop.onTasksChanged(() => announced.push(1))
  const session: TasksSession = createTasksSession({
    journal: Promise.resolve(core),
    desktop,
    clock,
    onChange: (next) => {
      snapshot = next
    },
  })

  return {
    session,
    core,
    clock,
    created,
    announced,
    desktop,
    now: () => snapshot,
  }
}

/** Which group each Task ended up in, by description. */
function groupsOf(snapshot: TasksSnapshot): Record<string, string[]> {
  if (snapshot.tasks.state !== 'tasks') return {}
  return Object.fromEntries(
    snapshot.tasks.groups
      .filter((group) => group.tasks.length > 0)
      .map((group) => [group.name, group.tasks.map((task) => task.description)]),
  )
}

function descriptionsOf(snapshot: TasksSnapshot): string[] {
  return snapshot.tasks.state === 'tasks'
    ? snapshot.tasks.tasks.map((task) => task.description)
    : []
}

describe('opening Tasks View', () => {
  it('opens on the Open Tasks, newest first', async () => {
    const { session, now } = await tasksSession(['first', 'second', 'third'])

    await session.open()

    expect(now().showing).toBe('open')
    expect(descriptionsOf(now())).toEqual(['third', 'second', 'first'])
  })

  it('opens on an empty list rather than on nothing', async () => {
    const { session, now } = await tasksSession()

    await session.open()

    expect(now().tasks).toMatchObject({ state: 'tasks', tasks: [] })
    expect(groupsOf(now())).toEqual({})
  })

  it('says the Tasks could not be read rather than loading forever', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const session = createTasksSession({
      journal: Promise.reject(new Error('no database')) as Promise<Journal>,
      desktop: fakeDesktop(),
      clock: fixedClock('2026-03-09T09:00:00'),
      onChange: () => {},
    })

    await session.open()

    expect(session.snapshot().tasks).toEqual({ state: 'unreadable' })
  })
})

describe('the two lists', () => {
  it('shows the Completed Tasks, newest completed first', async () => {
    const { session, core, clock, created, now } = await tasksSession([
      'first',
      'second',
    ])
    clock.set(new Date('2026-03-09T12:00:00'))
    await core.completeTask(created[1].id)
    clock.set(new Date('2026-03-09T13:00:00'))
    await core.completeTask(created[0].id)

    await session.open()
    await session.show('completed')

    expect(now().showing).toBe('completed')
    expect(descriptionsOf(now())).toEqual(['first', 'second'])
  })

  it('leaves Completed Tasks out of the Open list', async () => {
    const { session, core, created, now } = await tasksSession([
      'still owed',
      'already handled',
    ])
    await core.completeTask(created[1].id)

    await session.open()

    expect(descriptionsOf(now())).toEqual(['still owed'])
  })
})

describe('completing and reopening', () => {
  it('completes a Task and takes it out of the Open list at once', async () => {
    const { session, created, announced, now } = await tasksSession(['renew it'])
    await session.open()

    await session.complete(created[0].id)

    expect(descriptionsOf(now())).toEqual([])
    expect(announced).toHaveLength(1)

    await session.show('completed')
    expect(descriptionsOf(now())).toEqual(['renew it'])
  })

  it('reopens a Completed Task and takes it out of the Completed list', async () => {
    const { session, core, created, now } = await tasksSession(['renew it'])
    await core.completeTask(created[0].id)
    await session.open()
    await session.show('completed')

    await session.reopen(created[0].id)

    expect(descriptionsOf(now())).toEqual([])

    await session.show('open')
    expect(descriptionsOf(now())).toEqual(['renew it'])
  })
})

describe('editing a Task', () => {
  it('rewords it and re-reads the list', async () => {
    const { session, created, announced, now } = await tasksSession(['renew it'])
    await session.open()

    await session.save(created[0].id, {
      description: 'renew the TLS certificate',
      schedule: null,
    })

    expect(descriptionsOf(now())).toEqual(['renew the TLS certificate'])
    expect(announced).toHaveLength(1)
    expect(now().problem).toBeNull()
  })

  it('says so when the record refuses, and leaves the list as it was', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { session, created, announced, now } = await tasksSession(['renew it'])
    await session.open()

    await session.save(created[0].id, { description: '   ', schedule: null })

    expect(now().problem).toBe('That Task could not be saved.')
    expect(descriptionsOf(now())).toEqual(['renew it'])
    expect(announced).toHaveLength(0)
  })

  it('clears the problem once a change lands', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { session, created, now } = await tasksSession(['renew it'])
    await session.open()
    await session.save(created[0].id, { description: '', schedule: null })

    await session.save(created[0].id, {
      description: 'renewed',
      schedule: null,
    })

    expect(now().problem).toBeNull()
  })
})

describe('scheduling a Task from the Editor', () => {
  it('saves the wording and the schedule together', async () => {
    const { session, core, created, now } = await tasksSession(['renew it'])
    await session.open()

    await session.save(created[0].id, {
      description: 'renew the certificate',
      schedule: { date: '2026-03-16', time: '14:00' },
    })

    const [task] = await core.openTasks()
    expect(task.description).toBe('renew the certificate')
    expect(task.scheduledDate).toBe('2026-03-16')
    expect(task.scheduledTime).toBe('14:00')
    expect(now().problem).toBeNull()
  })

  it('moves the Task into its new group without a second read', async () => {
    const { session, created, now } = await tasksSession(['renew it'])
    await session.open()
    expect(groupsOf(now())).toEqual({ unscheduled: ['renew it'] })

    await session.save(created[0].id, {
      description: 'renew it',
      schedule: { date: '2026-03-09', time: '17:00' },
    })

    expect(groupsOf(now())).toEqual({ today: ['renew it'] })
  })

  it('rewords a Completed Task while its schedule stays put', async () => {
    const { session, core, created, now } = await tasksSession(['renew it'])
    await core.editTask(created[0].id, {
      description: 'renew it',
      schedule: { date: '2026-03-16', time: '14:00' },
    })
    await core.completeTask(created[0].id)
    await session.show('completed')

    // What the Editor sends for a Completed Task: the new wording, and the
    // schedule it was completed with, because it offers no way to change one.
    await session.save(created[0].id, {
      description: 'renewed it',
      schedule: { date: '2026-03-16', time: '14:00' },
    })

    const [task] = await core.completedTasks()
    expect(task.description).toBe('renewed it')
    expect(task.scheduledDate).toBe('2026-03-16')
    expect(now().problem).toBeNull()
  })

  it('refuses to move the schedule of a Completed Task, and says so', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { session, core, created, now } = await tasksSession(['renew it'])
    await core.editTask(created[0].id, {
      description: 'renew it',
      schedule: { date: '2026-03-16', time: '14:00' },
    })
    await core.completeTask(created[0].id)
    await session.show('completed')

    await session.save(created[0].id, {
      description: 'renewed it',
      schedule: null,
    })

    expect(now().problem).toBe('That Task could not be saved.')
    const [task] = await core.completedTasks()
    expect(task.description).toBe('renew it')
    expect(task.scheduledDate).toBe('2026-03-16')
  })

  it('never asks about an Alert for a Task already completed', async () => {
    const { session, core, created, desktop } = await tasksSession(['renew it'], {
      alertPermission: 'undetermined',
    })
    await core.completeTask(created[0].id)
    await session.show('completed')

    await session.save(created[0].id, {
      description: 'renewed it',
      schedule: null,
    })

    expect(desktop.alertPrompted).toBe(false)
  })
})

describe('asking about Task Alerts', () => {
  it('asks in context the first time a Task with a time is saved', async () => {
    const { session, created, desktop, now } = await tasksSession(['renew it'], {
      alertPermission: 'undetermined',
    })
    await session.open()

    await session.save(created[0].id, {
      description: 'renew it',
      schedule: { date: '2026-03-16', time: '14:00' },
    })

    expect(desktop.alertPrompted).toBe(true)
    expect(now().alertRefusal).toBeNull()
  })

  it('never asks for a Task with a date and no time', async () => {
    const { session, created, desktop } = await tasksSession(['renew it'], {
      alertPermission: 'undetermined',
    })
    await session.open()

    await session.save(created[0].id, {
      description: 'renew it',
      schedule: { date: '2026-03-16', time: null },
    })

    expect(desktop.alertPrompted).toBe(false)
  })

  it('never asks again once macOS has an answer on file', async () => {
    const { session, created, desktop } = await tasksSession(['renew it'], {
      alertPermission: 'granted',
    })
    await session.open()

    await session.save(created[0].id, {
      description: 'renew it',
      schedule: { date: '2026-03-16', time: '14:00' },
    })

    expect(desktop.alertPrompted).toBe(false)
  })

  it('saves the Task anyway when the permission is refused, and says so', async () => {
    const { session, core, created, now } = await tasksSession(['renew it'], {
      alertPermission: 'denied',
    })
    await session.open()

    await session.save(created[0].id, {
      description: 'renew it',
      schedule: { date: '2026-03-16', time: '14:00' },
    })

    expect(now().alertRefusal).toBe(ALERT_REFUSED)
    const [task] = await core.openTasks()
    expect(task.scheduledTime).toBe('14:00')
  })
})

describe('grouping the Open Tasks', () => {
  async function scheduled() {
    const built = await tasksSession()
    const { core } = built

    await core.createTask('last week', { date: '2026-03-02', time: null })
    await core.createTask('this evening', { date: '2026-03-09', time: '17:00' })
    await core.createTask('next week', { date: '2026-03-16', time: '09:00' })
    await core.createTask('someday')

    return built
  }

  it('says which of the four groups each Open Task is in', async () => {
    const { session, now } = await scheduled()

    await session.open()

    expect(groupsOf(now())).toEqual({
      overdue: ['last week'],
      today: ['this evening'],
      upcoming: ['next week'],
      unscheduled: ['someday'],
    })
  })

  it('re-groups on the day rolling over, without re-reading', async () => {
    const { session, clock, core, now } = await scheduled()
    await session.open()
    await core.deleteTask((await core.openTasks())[0].id)

    clock.set(new Date('2026-03-10T00:01:00'))
    session.regroup()

    // The deleted Task is still on screen: re-grouping asks the day, not the
    // database.
    expect(groupsOf(now())).toEqual({
      overdue: ['last week', 'this evening'],
      upcoming: ['next week'],
      unscheduled: ['someday'],
    })
  })

  it('leaves the Completed list ungrouped', async () => {
    const { session, now } = await scheduled()

    await session.show('completed')

    expect(groupsOf(now())).toEqual({})
  })
})

describe('deleting a Task', () => {
  it('removes it and re-reads the list', async () => {
    const { session, created, announced, now } = await tasksSession([
      'keep this',
      'delete this',
    ])
    await session.open()

    await session.delete(created[1].id)

    expect(descriptionsOf(now())).toEqual(['keep this'])
    expect(announced).toHaveLength(1)
  })

  it('says so when the record refuses', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { session, now } = await tasksSession(['keep this'])
    await session.open()

    await session.delete('missing')

    expect(now().problem).toBe('That Task could not be deleted.')
    expect(descriptionsOf(now())).toEqual(['keep this'])
  })
})

describe('a Task created elsewhere', () => {
  it('shows up in the list on a refresh, with no manual reload', async () => {
    const { session, core, clock, now } = await tasksSession(['already here'])
    await session.open()

    clock.set(new Date('2026-03-09T14:00:00'))
    await core.createTask('typed in the Task Creation window')
    await session.refresh()

    expect(descriptionsOf(now())).toEqual([
      'typed in the Task Creation window',
      'already here',
    ])
  })

  it('refreshes whichever list is showing', async () => {
    const { session, core, clock, now } = await tasksSession()
    await session.open()
    await session.show('completed')

    const task = await core.createTask('done elsewhere')
    clock.set(new Date('2026-03-09T14:00:00'))
    await core.completeTask(task.id)
    await session.refresh()

    expect(now().showing).toBe('completed')
    expect(descriptionsOf(now())).toEqual(['done elsewhere'])
  })
})

describe('a Recurring Task in the session', () => {
  const daily = { unit: 'day' as const, interval: 1, weekdays: [] }

  /** The occurrences the snapshot carries for one Task. */
  function occurrencesOf(snapshot: TasksSnapshot, taskId: string) {
    return snapshot.tasks.state === 'tasks'
      ? (snapshot.tasks.occurrences[taskId] ?? [])
      : []
  }

  it('carries the occurrences of every Recurring Task in the list', async () => {
    const { session, core, clock, now } = await tasksSession()
    const repeating = await core.createTask(
      'water the plants',
      { date: '2026-03-09', time: null },
      daily,
    )
    const ordinary = await core.createTask('once', { date: '2026-03-09', time: null })

    clock.set(new Date('2026-03-09T20:00:00'))
    await core.completeTask(repeating.id)
    await session.open()

    expect(occurrencesOf(now(), repeating.id)).toHaveLength(2)
    expect(occurrencesOf(now(), ordinary.id)).toEqual([])
  })

  it('completing advances the series and leaves it in the Open list', async () => {
    const { session, core, clock, now } = await tasksSession()
    const task = await core.createTask(
      'water the plants',
      { date: '2026-03-09', time: null },
      daily,
    )
    await session.open()

    clock.set(new Date('2026-03-09T20:00:00'))
    await session.complete(task.id)

    expect(groupsOf(now())).toEqual({ upcoming: ['water the plants'] })
    expect(now().problem).toBeNull()
  })

  it('undoes the latest completion and says so when it cannot', async () => {
    const { session, core, clock, now } = await tasksSession()
    const task = await core.createTask(
      'water the plants',
      { date: '2026-03-09', time: null },
      daily,
    )
    await session.open()

    clock.set(new Date('2026-03-09T20:00:00'))
    await session.complete(task.id)
    await session.undoCompletion(task.id)

    expect(now().problem).toBeNull()
    expect(occurrencesOf(now(), task.id)).toHaveLength(1)

    // Nothing left to take back.
    await session.undoCompletion(task.id)
    expect(now().problem).toMatch(/only the latest one can be/)
  })

  it('stops the recurrence and keeps the Task and its history', async () => {
    const { session, core, clock, now } = await tasksSession()
    const task = await core.createTask(
      'water the plants',
      { date: '2026-03-09', time: null },
      daily,
    )
    clock.set(new Date('2026-03-09T20:00:00'))
    await core.completeTask(task.id)
    await session.open()

    await session.stopRecurrence(task.id)

    expect(descriptionsOf(now())).toEqual(['water the plants'])
    // The rule is gone; what the Task already kept is not.
    expect(occurrencesOf(now(), task.id)).toHaveLength(1)
    expect(occurrencesOf(now(), task.id)[0].completedAt).not.toBeNull()
    expect(now().problem).toBeNull()
  })

  it('saves a cadence from the Editor', async () => {
    const { session, core, now } = await tasksSession()
    const task = await core.createTask('gym', { date: '2026-03-09', time: null })
    await session.open()

    await session.save(task.id, {
      description: 'gym',
      schedule: { date: '2026-03-09', time: null },
      recurrence: { unit: 'week', interval: 2, weekdays: [1, 4] },
    })

    expect(now().problem).toBeNull()
    expect(occurrencesOf(now(), task.id)).toHaveLength(1)
  })

  it('says so when a cadence the record refuses is saved', async () => {
    const { session, core, now } = await tasksSession()
    const task = await core.createTask('gym', { date: '2026-03-09', time: null })
    await session.open()

    await session.save(task.id, {
      description: 'gym',
      schedule: { date: '2026-03-09', time: null },
      recurrence: { unit: 'week', interval: 1, weekdays: [] },
    })

    expect(now().problem).toBe('That Task could not be saved.')
  })
})
