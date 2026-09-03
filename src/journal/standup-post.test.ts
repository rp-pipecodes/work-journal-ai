import { afterEach, describe, expect, it } from 'vitest'
import {
  createJournal,
  formatSlot,
  isOpen,
  slotOf,
  type Journal,
} from './journal'
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
    expect(selected.completedOccurrences).toEqual([])
  })

  it('files a completion just after local midnight under the same yesterday as an ordinary Task completed at the same instant', async () => {
    // July: Europe/Lisbon is at UTC+1, so 00:30 local on the 2nd is stored
    // 2026-07-01T23:30Z. The two records completed at that one instant must
    // land in the same half of the Standup Post — the local Journal Day both
    // were kept on — whichever query read them.
    const { journal, clock } = await journalAt('2026-07-01T23:05:00')
    const daily = await journal.createTask(
      'water the plants',
      { date: '2026-07-01', time: '23:00' },
      { unit: 'day', interval: 1, weekdays: [] },
    )
    const ordinary = await journal.createTask('the ordinary one')

    clock.set(new Date('2026-07-02T00:30:00'))
    await journal.completeTask(daily.id)
    await journal.completeTask(ordinary.id)
    clock.set(new Date('2026-07-03T09:00:00'))

    const selected = await selectStandupPost({ journal, clock })

    expect(selected.yesterday).toBe('2026-07-02')
    expect(selected.completedTasks.map((task) => task.description)).toEqual([
      'the ordinary one',
    ])
    expect(selected.completedOccurrences).toHaveLength(1)
    expect(
      formatSlot(slotOf(selected.completedOccurrences[0].occurrence)),
    ).toBe('2026-07-01 23:00')
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
      completedOccurrences: [],
      openTasks: [],
    })
  })

  it('selects occurrences completed yesterday with their parent Tasks, and never the parent as completed', async () => {
    const { journal, clock } = await journalAt('2026-03-11T08:00:00')
    const daily = await journal.createTask(
      'water the plants',
      { date: '2026-03-11', time: '09:00' },
      { unit: 'day', interval: 1, weekdays: [] },
    )
    // The series opens on the day's own slot, still ahead at 08:00.
    expect(daily.scheduledDate).toBe('2026-03-11')

    clock.set(new Date('2026-03-11T10:00:00'))
    await journal.completeTask(daily.id) // the day's slot kept, parent now stands on tomorrow's…

    // Take the continuing series out of the Standup Post's Open half — a
    // schedule edit reanchors it without touching the kept history — so this
    // test's Open half holds exactly the parent for the wrong reason.
    clock.set(new Date('2026-03-12T09:00:00'))
    await journal.editTask(daily.id, {
      description: 'water the plants',
      schedule: { date: '2026-03-16', time: '09:00' },
    })

    const selected = await selectStandupPost({ journal, clock })

    // Yesterday's completion is the occurrence's record…
    expect(selected.completedOccurrences).toHaveLength(1)
    expect(selected.completedOccurrences[0].occurrence.taskId).toBe(daily.id)
    expect(
      formatSlot(slotOf(selected.completedOccurrences[0].occurrence)),
    ).toBe('2026-03-11 09:00')
    // …and the parent is gone from the Open half entirely — the selection
    // never completed it, and its slot has moved out of today's groups.
    expect(
      selected.openTasks.some((task) => task.id === daily.id),
    ).toBe(false)
    // The parent Task riding along reads whole — still Open, never completed.
    expect(isOpen(selected.completedOccurrences[0].task)).toBe(true)
    expect(selected.completedOccurrences[0].task.completedAt).toBeNull()

    // A completion today is kept by the series but is not yesterday's work.
    clock.set(new Date('2026-03-12T09:15:00'))
    await journal.completeTask(daily.id)
    const after = await selectStandupPost({ journal, clock })
    expect(after.completedOccurrences).toHaveLength(1)
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

  it('reads Completed yesterday newest completion first across both record types', async () => {
    // The occurrence is kept at 09:00 and the ordinary Task completed at
    // 18:00 the same day, so the concatenation the section used before would
    // read the occurrence first; the section is one set of work kept, and
    // reads newest completion first whoever owns the record.
    const { journal, clock } = await journalAt('2026-03-11T08:00:00')
    const daily = await journal.createTask(
      'water the plants',
      { date: '2026-03-11', time: '09:00' },
      { unit: 'day', interval: 1, weekdays: [] },
    )

    clock.set(new Date('2026-03-11T09:15:00'))
    await journal.completeTask(daily.id)
    clock.set(new Date('2026-03-11T18:00:00'))
    const ordinary = await journal.createTask('chase the invoice')
    await journal.completeTask(ordinary.id)

    clock.set(new Date('2026-03-12T09:00:00'))
    await journal.editTask(daily.id, {
      description: 'water the plants',
      schedule: { date: '2026-03-16', time: '09:00' },
    })

    const selection = await selectStandupPost({ journal, clock })
    const userContent = await buildStandupPostInput({ journal, selection })

    expect(userContent).toBe(`## Completed yesterday
- [x] chase the invoice
- [x] water the plants (occurrence 2026-03-11 09:00)`)
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

  it('renders a completed occurrence as one checked bullet carrying its slot', async () => {
    const { journal, clock } = await journalAt('2026-03-11T08:00:00')
    const daily = await journal.createTask(
      'Water the plants',
      { date: '2026-03-11', time: '09:00' },
      { unit: 'day', interval: 1, weekdays: [] },
    )

    clock.set(new Date('2026-03-11T10:00:00'))
    await journal.completeTask(daily.id)
    clock.set(new Date('2026-03-12T09:00:00'))
    // Take the continuing series out of the Open half, so this day's only
    // Standup Post content is yesterday's kept occurrence.
    await journal.editTask(daily.id, {
      description: 'Water the plants',
      schedule: { date: '2026-03-16', time: '09:00' },
    })

    const selection = await selectStandupPost({ journal, clock })
    const userContent = await buildStandupPostInput({ journal, selection })

    // The checkbox is the occurrence's, and the slot is spelled the one way
    // the app spells a slot. The parent appears nowhere as completed.
    expect(userContent).toBe(`## Completed yesterday
- [x] Water the plants (occurrence 2026-03-11 09:00)`)
  })

  it('renders a recurring Task kept yesterday in both halves, deliberately', async () => {
    const { journal, clock } = await journalAt('2026-03-11T08:00:00')
    const daily = await journal.createTask(
      'water the plants',
      { date: '2026-03-11', time: '09:00' },
      { unit: 'day', interval: 1, weekdays: [] },
    )

    clock.set(new Date('2026-03-11T10:00:00'))
    await journal.completeTask(daily.id) // yesterday's slot kept…
    clock.set(new Date('2026-03-12T09:00:00')) // …and the parent now stands overdue on today's.

    const selection = await selectStandupPost({ journal, clock })
    const userContent = await buildStandupPostInput({ journal, selection })

    // The same Task Description twice is correct and deliberate: the kept
    // occurrence is work done, while the Task itself carries on.
    expect(userContent).toBe(`## Completed yesterday
- [x] water the plants (occurrence 2026-03-11 09:00)

## Still to do
- [ ] water the plants (scheduled 2026-03-12 09:00)`)
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

  it('no longer refuses a day whose only content is a completed occurrence', async () => {
    const { journal, clock } = await journalAt('2026-03-12T09:00:00')
    const daily = await journal.createTask(
      'water the plants',
      { date: '2026-03-10', time: '09:00' },
      { unit: 'day', interval: 1, weekdays: [] },
    )

    clock.set(new Date('2026-03-11T09:15:00'))
    await journal.completeTask(daily.id)
    clock.set(new Date('2026-03-12T09:00:00'))

    const onlyAnOccurrence = await selectStandupPost({ journal, clock })

    // A kept recurring commitment is real work: this unblocks a billable
    // Generate on days that are refused for free today, on purpose.
    expect(standupPostRefuses(onlyAnOccurrence)).toBe(false)
  })
})
