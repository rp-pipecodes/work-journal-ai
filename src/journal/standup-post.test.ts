import { afterEach, describe, expect, it } from 'vitest'
import { createJournal, type Journal } from './journal'
import { fixedClock, openTestDatabase } from './testing/database'
import {
  buildStandupPostInput,
  selectStandupPost,
  standupPostRefuses,
} from './standup-post'

// The Standup Post's input is deliberately tested at the Journal boundary:
// real SQL proves that the section is selecting the records the user sees,
// while the clock makes yesterday and today's Task groups deterministic.

const openJournals: Array<() => void> = []

afterEach(() => {
  for (const close of openJournals.splice(0)) close()
})

async function journalAt(instant: string): Promise<{
  journal: Journal
  clock: ReturnType<typeof fixedClock>
}> {
  const { driver, close } = await openTestDatabase()
  openJournals.push(close)
  const clock = fixedClock(instant)
  return { journal: createJournal({ clock, driver }), clock }
}

describe('selectStandupPost', () => {
  it('selects yesterday’s Notes and Tasks completed yesterday', async () => {
    const { journal, clock } = await journalAt('2026-03-12T09:00:00')

    clock.set(new Date('2026-03-11T09:30:00'))
    await journal.capture('yesterday’s Note')
    const completedYesterday = await journal.createTask('kept yesterday')
    await journal.completeTask(completedYesterday.id)

    clock.set(new Date('2026-03-12T08:30:00'))
    const completedToday = await journal.createTask('kept today')
    await journal.completeTask(completedToday.id)
    await journal.capture('today’s Note')

    const selected = await selectStandupPost({ journal, clock })

    expect(selected.yesterday).toBe('2026-03-11')
    expect(selected.notes.map((note) => note.body)).toEqual(["yesterday’s Note"])
    expect(selected.completedTasks.map((task) => task.description)).toEqual([
      'kept yesterday',
    ])
  })

  it('selects Overdue and today Open Tasks, not Upcoming or Unscheduled', async () => {
    const { journal, clock } = await journalAt('2026-03-12T09:00:00')

    await journal.createTask('overdue', { date: '2026-03-10', time: null })
    await journal.createTask('today', { date: '2026-03-12', time: '17:00' })
    await journal.createTask('upcoming', { date: '2026-03-13', time: null })
    await journal.createTask('unscheduled')

    const selected = await selectStandupPost({ journal, clock })

    expect(selected.openTasks.map((task) => task.description)).toEqual([
      'overdue',
      'today',
    ])
  })

  it('returns both halves empty when there is nothing to say', async () => {
    const { journal, clock } = await journalAt('2026-03-12T09:00:00')

    const selected = await selectStandupPost({ journal, clock })

    expect(selected).toEqual({
      yesterday: '2026-03-11',
      notes: [],
      completedTasks: [],
      openTasks: [],
    })
  })
})

describe('buildStandupPostInput', () => {
  it('sends yesterday’s Digest verbatim, #project prefixes and all, plus the two Task lists', async () => {
    const { journal, clock } = await journalAt('2026-03-12T09:00:00')

    clock.set(new Date('2026-03-11T09:00:00'))
    await journal.capture('#ops shipped the migration')
    clock.set(new Date('2026-03-11T09:05:00'))
    await journal.capture('plain note')
    const completed = await journal.createTask('kept yesterday')
    await journal.completeTask(completed.id)

    clock.set(new Date('2026-03-12T09:00:00'))
    await journal.createTask('overdue', { date: '2026-03-10', time: null })
    await journal.createTask('today', { date: '2026-03-12', time: '17:00' })
    await journal.createTask('upcoming', { date: '2026-03-13', time: null })

    const selection = await selectStandupPost({ journal, clock })
    const userContent = await buildStandupPostInput({ journal, selection })

    // The Notes half is exactly what the journal's Digest renders — the same
    // Markdown History would copy — and the Tasks are one bullet each.
    expect(userContent).toBe(`- #ops shipped the migration
- plain note

## Completed yesterday
- [x] kept yesterday

## Still to do
- [ ] overdue (scheduled 2026-03-10)
- [ ] today (scheduled 2026-03-12 17:00)`)
  })

  it('sends an empty yesterday alone as today’s Tasks', async () => {
    const { journal, clock } = await journalAt('2026-03-12T09:00:00')

    await journal.createTask('today', { date: '2026-03-12', time: '17:00' })

    const selection = await selectStandupPost({ journal, clock })
    const userContent = await buildStandupPostInput({ journal, selection })

    expect(userContent).toBe(`## Still to do
- [ ] today (scheduled 2026-03-12 17:00)`)
  })

  it('sends yesterday alone when there is nothing still to do', async () => {
    const { journal, clock } = await journalAt('2026-03-12T09:00:00')

    clock.set(new Date('2026-03-11T09:00:00'))
    await journal.capture('a note')
    clock.set(new Date('2026-03-12T09:00:00'))

    const selection = await selectStandupPost({ journal, clock })
    const userContent = await buildStandupPostInput({ journal, selection })

    expect(userContent).toBe('- a note')
  })

  it('leaves no empty section when a half has nothing in it', async () => {
    const { journal, clock } = await journalAt('2026-03-12T09:00:00')

    // The Task is completed while the clock still says yesterday.
    clock.set(new Date('2026-03-11T09:00:00'))
    const completed = await journal.createTask('kept yesterday')
    await journal.completeTask(completed.id)
    clock.set(new Date('2026-03-12T09:00:00'))

    const selection = await selectStandupPost({ journal, clock })
    const userContent = await buildStandupPostInput({ journal, selection })

    // No Notes yesterday, but the completed Task stands on its own.
    expect(userContent).toBe(`## Completed yesterday
- [x] kept yesterday`)
  })
})

describe('standupPostRefuses', () => {
  it('refuses only a day with neither half', async () => {
    const { journal, clock } = await journalAt('2026-03-12T09:00:00')

    const empty = await selectStandupPost({ journal, clock })
    expect(standupPostRefuses(empty)).toBe(true)

    // Yesterday alone: a Note and a Task completed yesterday.
    clock.set(new Date('2026-03-11T09:00:00'))
    await journal.capture('a note')
    const completed = await journal.createTask('kept')
    await journal.completeTask(completed.id)
    clock.set(new Date('2026-03-12T09:00:00'))

    const onlyYesterday = await selectStandupPost({ journal, clock })
    expect(standupPostRefuses(onlyYesterday)).toBe(false)

    // Today's Tasks stand on their own.
    await journal.createTask('today', { date: '2026-03-12', time: null })
    const bothHalves = await selectStandupPost({ journal, clock })
    expect(standupPostRefuses(bothHalves)).toBe(false)
  })
})
