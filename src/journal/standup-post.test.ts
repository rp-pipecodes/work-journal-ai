import { afterEach, describe, expect, it } from 'vitest'
import { createJournal, type Journal } from './journal'
import { fixedClock, openTestDatabase } from './testing/database'
import { selectStandupPost } from './standup-post'

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
