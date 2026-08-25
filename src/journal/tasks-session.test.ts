import { afterEach, describe, expect, it, vi } from 'vitest'
import { createJournal, type Journal, type Task } from './journal'
import {
  createTasksSession,
  openingTasksSnapshot,
  type TasksSession,
  type TasksSnapshot,
} from './tasks-session'
import { fixedClock, openTestDatabase } from './testing/database'

// Every test drives a real journal over real SQL. Nothing here asserts that a
// particular query ran.

const openDatabases: Array<() => void> = []

afterEach(() => {
  for (const close of openDatabases.splice(0)) close()
})

async function tasksSession(descriptions: string[] = []) {
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
  const session: TasksSession = createTasksSession({
    journal: Promise.resolve(core),
    announceChange: () => announced.push(1),
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
    now: () => snapshot,
  }
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

    expect(now().tasks).toEqual({ state: 'tasks', tasks: [] })
  })

  it('says the Tasks could not be read rather than loading forever', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const session = createTasksSession({
      journal: Promise.reject(new Error('no database')) as Promise<Journal>,
      announceChange: () => {},
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

    await session.editDescription(created[0].id, 'renew the TLS certificate')

    expect(descriptionsOf(now())).toEqual(['renew the TLS certificate'])
    expect(announced).toHaveLength(1)
    expect(now().problem).toBeNull()
  })

  it('says so when the record refuses, and leaves the list as it was', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { session, created, announced, now } = await tasksSession(['renew it'])
    await session.open()

    await session.editDescription(created[0].id, '   ')

    expect(now().problem).toBe('That Task could not be reworded.')
    expect(descriptionsOf(now())).toEqual(['renew it'])
    expect(announced).toHaveLength(0)
  })

  it('clears the problem once a change lands', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { session, created, now } = await tasksSession(['renew it'])
    await session.open()
    await session.editDescription(created[0].id, '')

    await session.editDescription(created[0].id, 'renewed')

    expect(now().problem).toBeNull()
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
