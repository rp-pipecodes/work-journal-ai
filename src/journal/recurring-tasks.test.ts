import { afterEach, describe, expect, it } from 'vitest'
import {
  advancedSlot,
  canUndoCompletion,
  completedOccurrences,
  createJournal,
  formatRecurrence,
  openOccurrence,
  openingSlot,
  sameRecurrence,
  type Journal,
  type Recurrence,
  type SqlDriver,
  type SqlStatement,
  type Task,
} from './journal'
import { fixedClock, openTestDatabase } from './testing/database'

// Every test drives the core through its public operations, against the same
// SQL the app ships — including the index that permits exactly one Open
// occurrence per Recurring Task.

const openJournals: Array<() => void> = []

afterEach(() => {
  for (const close of openJournals.splice(0)) close()
})

async function journalAt(instant: string): Promise<{
  journal: Journal
  clock: ReturnType<typeof fixedClock>
  driver: SqlDriver
}> {
  const { driver, close } = await openTestDatabase()
  openJournals.push(close)
  const clock = fixedClock(instant)
  return { journal: createJournal({ clock, driver }), clock, driver }
}

/** A cadence written the way a control hands one over. */
function every(
  interval: number,
  unit: Recurrence['unit'],
  weekdays: number[] = [],
): Recurrence {
  return { unit, interval, weekdays }
}

/** How many Open occurrences the database holds for a Task, asked of SQL. */
async function openCount(driver: SqlDriver, taskId: string): Promise<number> {
  const rows = await driver.select<{ count: number }>(
    'SELECT COUNT(*) AS count FROM task_occurrences WHERE task_id = ? AND completed_at IS NULL',
    [taskId],
  )
  return rows[0].count
}

describe('creating a Recurring Task', () => {
  it('opens on the starting date when that is still ahead', async () => {
    const { journal } = await journalAt('2026-03-16T10:00:00')

    const task = await journal.createTask(
      'water the plants',
      { date: '2026-03-20', time: '09:00' },
      every(1, 'day'),
    )

    expect(task.scheduledDate).toBe('2026-03-20')
    expect(task.recurrenceAnchor).toBe('2026-03-20')
    expect(task.recurrence).toEqual(every(1, 'day'))
  })

  it('opens on the latest elapsed slot when the start is in the past', async () => {
    const { journal } = await journalAt('2026-03-16T10:00:00')

    const task = await journal.createTask(
      'stand-up notes',
      { date: '2026-03-01', time: '09:00' },
      every(1, 'day'),
    )

    // Today's 09:00 is gone, so today is the latest elapsed slot.
    expect(task.scheduledDate).toBe('2026-03-16')
    expect(task.recurrenceAnchor).toBe('2026-03-01')
  })

  it('does not open on today when today has not reached its own minute', async () => {
    const { journal } = await journalAt('2026-03-16T08:00:00')

    const task = await journal.createTask(
      'stand-up notes',
      { date: '2026-03-01', time: '09:00' },
      every(1, 'day'),
    )

    expect(task.scheduledDate).toBe('2026-03-15')
  })

  it('never materializes the slots a past start missed', async () => {
    const { journal, driver } = await journalAt('2026-03-16T10:00:00')

    const task = await journal.createTask(
      'stand-up notes',
      { date: '2026-01-01', time: '09:00' },
      every(1, 'day'),
    )

    const occurrences = await journal.occurrencesOf(task.id)
    expect(occurrences).toHaveLength(1)
    expect(await openCount(driver, task.id)).toBe(1)
  })

  it('refuses a cadence with no date to be counted from', async () => {
    const { journal } = await journalAt('2026-03-16T10:00:00')

    await expect(
      journal.createTask('someday', null, every(1, 'week', [1])),
    ).rejects.toThrow(/Scheduled For date/)
  })

  it('refuses a weekly cadence with no weekday selected', async () => {
    const { journal } = await journalAt('2026-03-16T10:00:00')

    await expect(
      journal.createTask('weekly', { date: '2026-03-16', time: null }, every(1, 'week')),
    ).rejects.toThrow(/at least one weekday/)
  })

  it('refuses a cadence of less than one unit', async () => {
    const { journal } = await journalAt('2026-03-16T10:00:00')

    await expect(
      journal.createTask('weekly', { date: '2026-03-16', time: null }, every(0, 'day')),
    ).rejects.toThrow(/whole unit/)
  })

  it('keeps a Recurring Task out of the Completed list entirely', async () => {
    const { journal } = await journalAt('2026-03-16T10:00:00')

    const task = await journal.createTask(
      'water the plants',
      { date: '2026-03-16', time: null },
      every(1, 'day'),
    )
    await journal.completeTask(task.id)

    expect(await journal.completedTasks()).toEqual([])
    expect((await journal.openTasks()).map((one) => one.id)).toEqual([task.id])
  })
})

describe('every cadence', () => {
  async function advancing(
    schedule: { date: string; time: string | null },
    recurrence: Recurrence,
    now: string,
    times: number,
  ): Promise<string[]> {
    const { journal, clock } = await journalAt(now)
    const task = await journal.createTask('repeat', schedule, recurrence)

    const slots = [task.scheduledDate!]
    let current: Task = task
    for (let round = 0; round < times; round += 1) {
      // Completing on the day of the slot, so nothing is ever skipped for
      // having been missed.
      clock.set(new Date(`${current.scheduledDate}T23:00:00`))
      current = await journal.completeTask(current.id)
      slots.push(current.scheduledDate!)
    }

    return slots
  }

  it('steps whole days', async () => {
    expect(
      await advancing(
        { date: '2026-03-16', time: null },
        every(1, 'day'),
        '2026-03-16T08:00:00',
        3,
      ),
    ).toEqual(['2026-03-16', '2026-03-17', '2026-03-18', '2026-03-19'])
  })

  it('steps every N days', async () => {
    expect(
      await advancing(
        { date: '2026-03-16', time: null },
        every(3, 'day'),
        '2026-03-16T08:00:00',
        3,
      ),
    ).toEqual(['2026-03-16', '2026-03-19', '2026-03-22', '2026-03-25'])
  })

  it('steps whole weeks on the starting weekday', async () => {
    expect(
      await advancing(
        { date: '2026-03-16', time: null },
        every(1, 'week', [1]),
        '2026-03-16T08:00:00',
        2,
      ),
    ).toEqual(['2026-03-16', '2026-03-23', '2026-03-30'])
  })

  it('steps whole months', async () => {
    expect(
      await advancing(
        { date: '2026-03-16', time: null },
        every(1, 'month'),
        '2026-03-16T08:00:00',
        2,
      ),
    ).toEqual(['2026-03-16', '2026-04-16', '2026-05-16'])
  })

  it('steps every N months', async () => {
    expect(
      await advancing(
        { date: '2026-03-16', time: null },
        every(4, 'month'),
        '2026-03-16T08:00:00',
        2,
      ),
    ).toEqual(['2026-03-16', '2026-07-16', '2026-11-16'])
  })

  it('steps whole years', async () => {
    expect(
      await advancing(
        { date: '2026-03-16', time: null },
        every(1, 'year'),
        '2026-03-16T08:00:00',
        2,
      ),
    ).toEqual(['2026-03-16', '2027-03-16', '2028-03-16'])
  })

  it('steps every N years', async () => {
    expect(
      await advancing(
        { date: '2026-03-16', time: null },
        every(2, 'year'),
        '2026-03-16T08:00:00',
        1,
      ),
    ).toEqual(['2026-03-16', '2028-03-16'])
  })
})

describe('a weekly cadence with several weekdays', () => {
  const monWedFri = every(1, 'week', [1, 3, 5])

  it('advances through the selected days in order, one Open at a time', async () => {
    // Monday 16 March 2026.
    const { journal, clock } = await journalAt('2026-03-16T08:00:00')
    const task = await journal.createTask(
      'gym',
      { date: '2026-03-16', time: null },
      monWedFri,
    )

    expect(task.scheduledDate).toBe('2026-03-16')

    clock.set(new Date('2026-03-16T20:00:00'))
    const wednesday = await journal.completeTask(task.id)
    expect(wednesday.scheduledDate).toBe('2026-03-18')

    clock.set(new Date('2026-03-18T20:00:00'))
    const friday = await journal.completeTask(task.id)
    expect(friday.scheduledDate).toBe('2026-03-20')

    clock.set(new Date('2026-03-20T20:00:00'))
    const nextMonday = await journal.completeTask(task.id)
    expect(nextMonday.scheduledDate).toBe('2026-03-23')

    expect(openOccurrence(await journal.occurrencesOf(task.id))).not.toBeNull()
    expect(completedOccurrences(await journal.occurrencesOf(task.id))).toHaveLength(3)
  })

  it('ignores selected weekdays that fall before the starting date', async () => {
    // Wednesday 18 March 2026: the Monday of that week is not a slot.
    const { journal } = await journalAt('2026-03-18T08:00:00')

    const task = await journal.createTask(
      'gym',
      { date: '2026-03-18', time: null },
      monWedFri,
    )

    expect(task.scheduledDate).toBe('2026-03-18')
  })

  it('counts every-N weeks from the Monday-based week containing the start', async () => {
    // Friday 20 March 2026 starts a fortnightly series on Mondays.
    const { journal, clock } = await journalAt('2026-03-20T08:00:00')

    const task = await journal.createTask(
      'retro',
      { date: '2026-03-20', time: null },
      every(2, 'week', [1]),
    )

    // The week containing 20 March is the first active week, and its Monday is
    // before the start, so the first slot is the Monday of the week after next.
    expect(task.scheduledDate).toBe('2026-03-30')

    clock.set(new Date('2026-03-30T20:00:00'))
    expect((await journal.completeTask(task.id)).scheduledDate).toBe('2026-04-13')
  })

  it('takes its weekdays in ascending order however they are given', async () => {
    const { journal } = await journalAt('2026-03-16T08:00:00')

    const task = await journal.createTask(
      'gym',
      { date: '2026-03-16', time: null },
      every(1, 'week', [5, 1, 3, 1]),
    )

    expect(task.recurrence?.weekdays).toEqual([1, 3, 5])
  })
})

describe('month-end and leap-year recovery', () => {
  it('falls back to the last day of a shorter month and returns after it', async () => {
    const { journal, clock } = await journalAt('2026-01-31T08:00:00')

    const task = await journal.createTask(
      'invoice',
      { date: '2026-01-31', time: null },
      every(1, 'month'),
    )
    expect(task.scheduledDate).toBe('2026-01-31')

    clock.set(new Date('2026-01-31T20:00:00'))
    expect((await journal.completeTask(task.id)).scheduledDate).toBe('2026-02-28')

    clock.set(new Date('2026-02-28T20:00:00'))
    expect((await journal.completeTask(task.id)).scheduledDate).toBe('2026-03-31')

    clock.set(new Date('2026-03-31T20:00:00'))
    expect((await journal.completeTask(task.id)).scheduledDate).toBe('2026-04-30')

    clock.set(new Date('2026-04-30T20:00:00'))
    expect((await journal.completeTask(task.id)).scheduledDate).toBe('2026-05-31')
  })

  it('falls back to 28 February and returns on the next leap year', async () => {
    const { journal, clock } = await journalAt('2024-02-29T08:00:00')

    const task = await journal.createTask(
      'leap day',
      { date: '2024-02-29', time: null },
      every(1, 'year'),
    )
    expect(task.scheduledDate).toBe('2024-02-29')

    for (const [completedOn, next] of [
      ['2024-02-29', '2025-02-28'],
      ['2025-02-28', '2026-02-28'],
      ['2026-02-28', '2027-02-28'],
      ['2027-02-28', '2028-02-29'],
    ]) {
      clock.set(new Date(`${completedOn}T20:00:00`))
      expect((await journal.completeTask(task.id)).scheduledDate).toBe(next)
    }
  })
})

describe('completing an overdue occurrence', () => {
  it('skips the slots that were missed rather than opening every one', async () => {
    const { journal, clock } = await journalAt('2026-03-01T08:00:00')

    const task = await journal.createTask(
      'stand-up notes',
      { date: '2026-03-01', time: '09:00' },
      every(1, 'day'),
    )

    // A fortnight away. The occurrence is still 1 March; completing it lands
    // on the next slot that is still ahead, not on 2 March.
    clock.set(new Date('2026-03-15T10:00:00'))
    const advanced = await journal.completeTask(task.id)

    expect(advanced.scheduledDate).toBe('2026-03-16')
    expect(await journal.occurrencesOf(task.id)).toHaveLength(2)
  })

  it('lands on today when today has not reached its own minute yet', async () => {
    const { journal, clock } = await journalAt('2026-03-01T08:00:00')

    const task = await journal.createTask(
      'stand-up notes',
      { date: '2026-03-01', time: '09:00' },
      every(1, 'day'),
    )

    clock.set(new Date('2026-03-15T08:00:00'))
    expect((await journal.completeTask(task.id)).scheduledDate).toBe('2026-03-15')
  })

  it('keeps the completed occurrence in the history of its own Task', async () => {
    const { journal, clock } = await journalAt('2026-03-16T08:00:00')

    const task = await journal.createTask(
      'water the plants',
      { date: '2026-03-16', time: null },
      every(1, 'day'),
    )

    clock.set(new Date('2026-03-16T20:00:00'))
    await journal.completeTask(task.id)

    const history = completedOccurrences(await journal.occurrencesOf(task.id))
    expect(history).toHaveLength(1)
    expect(history[0].scheduledDate).toBe('2026-03-16')
    expect(history[0].completedAt).toBe(new Date('2026-03-16T20:00:00').toISOString())
    expect(await journal.completedTasks()).toEqual([])
  })
})

describe('editing a Recurring Task', () => {
  it('reanchors the series when the starting date changes', async () => {
    const { journal } = await journalAt('2026-03-16T08:00:00')

    const task = await journal.createTask(
      'gym',
      { date: '2026-03-16', time: null },
      every(1, 'week', [1]),
    )

    const moved = await journal.editTask(task.id, {
      description: 'gym',
      schedule: { date: '2026-03-19', time: null },
      recurrence: every(1, 'week', [4]),
    })

    expect(moved.scheduledDate).toBe('2026-03-19')
    expect(moved.recurrenceAnchor).toBe('2026-03-19')
    // Replaced, not completed: nothing went into the history.
    expect(completedOccurrences(await journal.occurrencesOf(task.id))).toEqual([])
    expect(await journal.occurrencesOf(task.id)).toHaveLength(1)
  })

  it('reanchors when only the time changes', async () => {
    const { journal } = await journalAt('2026-03-16T08:00:00')

    const task = await journal.createTask(
      'stand-up',
      { date: '2026-03-16', time: '09:00' },
      every(1, 'day'),
    )
    const before = openOccurrence(await journal.occurrencesOf(task.id))!

    const retimed = await journal.editTask(task.id, {
      description: 'stand-up',
      schedule: { date: '2026-03-16', time: '07:00' },
      recurrence: every(1, 'day'),
    })

    expect(retimed.scheduledTime).toBe('07:00')
    const after = openOccurrence(await journal.occurrencesOf(task.id))!
    expect(after.id).not.toBe(before.id)
    expect(after.advancedFrom).toBeNull()
  })

  it('reanchors onto the latest elapsed slot, which is Overdue', async () => {
    const { journal } = await journalAt('2026-03-16T10:00:00')

    const task = await journal.createTask(
      'gym',
      { date: '2026-03-16', time: null },
      every(1, 'day'),
    )

    const moved = await journal.editTask(task.id, {
      description: 'gym',
      schedule: { date: '2026-03-01', time: '09:00' },
      recurrence: every(1, 'day'),
    })

    expect(moved.scheduledDate).toBe('2026-03-16')
    expect(moved.scheduledTime).toBe('09:00')
  })

  it('leaves the series exactly where it stands when only the wording changes', async () => {
    const { journal } = await journalAt('2026-03-16T08:00:00')

    const task = await journal.createTask(
      'gym',
      { date: '2026-03-16', time: null },
      every(1, 'day'),
    )
    const before = openOccurrence(await journal.occurrencesOf(task.id))!

    const reworded = await journal.editTask(task.id, {
      description: 'the gym',
      schedule: { date: '2026-03-16', time: null },
      recurrence: every(1, 'day'),
    })

    expect(reworded.description).toBe('the gym')
    expect(openOccurrence(await journal.occurrencesOf(task.id))!.id).toBe(before.id)
  })

  it('turns an ordinary Task into a Recurring one', async () => {
    const { journal } = await journalAt('2026-03-16T08:00:00')

    const task = await journal.createTask('gym', { date: '2026-03-16', time: null })
    expect(await journal.occurrencesOf(task.id)).toEqual([])

    const repeating = await journal.editTask(task.id, {
      description: 'gym',
      schedule: { date: '2026-03-16', time: null },
      recurrence: every(1, 'week', [1]),
    })

    expect(repeating.recurrence).toEqual(every(1, 'week', [1]))
    expect(await journal.occurrencesOf(task.id)).toHaveLength(1)
  })

  it('leaves the cadence alone when an edit does not mention it', async () => {
    const { journal } = await journalAt('2026-03-16T08:00:00')

    const task = await journal.createTask(
      'gym',
      { date: '2026-03-16', time: null },
      every(1, 'day'),
    )

    const reworded = await journal.editTask(task.id, {
      description: 'the gym',
      schedule: { date: '2026-03-16', time: null },
    })

    expect(reworded.recurrence).toEqual(every(1, 'day'))
  })

  it('stops the recurrence when the date is cleared', async () => {
    const { journal } = await journalAt('2026-03-16T08:00:00')

    const task = await journal.createTask(
      'gym',
      { date: '2026-03-16', time: null },
      every(1, 'day'),
    )
    await journal.completeTask(task.id)

    const unscheduled = await journal.editTask(task.id, {
      description: 'gym',
      schedule: null,
    })

    expect(unscheduled.recurrence).toBeNull()
    expect(unscheduled.recurrenceAnchor).toBeNull()
    expect(unscheduled.scheduledDate).toBeNull()
    // The history is retained; only the Open occurrence goes.
    expect(completedOccurrences(await journal.occurrencesOf(task.id))).toHaveLength(1)
    expect(openOccurrence(await journal.occurrencesOf(task.id))).toBeNull()
  })
})

describe('Stop Recurrence', () => {
  it('keeps the Task where it stands and its history under it', async () => {
    const { journal, clock } = await journalAt('2026-03-16T08:00:00')

    const task = await journal.createTask(
      'gym',
      { date: '2026-03-16', time: '09:00' },
      every(1, 'day'),
    )
    clock.set(new Date('2026-03-16T20:00:00'))
    const advanced = await journal.completeTask(task.id)

    const stopped = await journal.stopRecurrence(task.id)

    expect(stopped.recurrence).toBeNull()
    expect(stopped.scheduledDate).toBe(advanced.scheduledDate)
    expect(stopped.scheduledTime).toBe('09:00')
    expect(completedOccurrences(await journal.occurrencesOf(task.id))).toHaveLength(1)
    expect(openOccurrence(await journal.occurrencesOf(task.id))).toBeNull()
  })

  it('leaves an ordinary Task untouched', async () => {
    const { journal } = await journalAt('2026-03-16T08:00:00')

    const task = await journal.createTask('gym', { date: '2026-03-16', time: null })

    expect(await journal.stopRecurrence(task.id)).toEqual(task)
  })

  it('lets the Task be completed like any other afterwards', async () => {
    const { journal, clock } = await journalAt('2026-03-16T08:00:00')

    const task = await journal.createTask(
      'gym',
      { date: '2026-03-16', time: null },
      every(1, 'day'),
    )
    await journal.stopRecurrence(task.id)

    clock.set(new Date('2026-03-16T20:00:00'))
    const completed = await journal.completeTask(task.id)

    expect(completed.completedAt).not.toBeNull()
    expect((await journal.completedTasks()).map((one) => one.id)).toEqual([task.id])
  })
})

describe('Undo Completion', () => {
  async function completedOnce() {
    const { journal, clock, driver } = await journalAt('2026-03-16T08:00:00')
    const task = await journal.createTask(
      'water the plants',
      { date: '2026-03-16', time: null },
      every(1, 'day'),
    )
    clock.set(new Date('2026-03-16T20:00:00'))
    await journal.completeTask(task.id)
    return { journal, clock, driver, task }
  }

  it('restores the completed occurrence and removes what it advanced to', async () => {
    const { journal, driver, task } = await completedOnce()

    const restored = await journal.undoCompletion(task.id)

    expect(restored.scheduledDate).toBe('2026-03-16')
    expect(await journal.occurrencesOf(task.id)).toHaveLength(1)
    expect(await openCount(driver, task.id)).toBe(1)
    expect(completedOccurrences(await journal.occurrencesOf(task.id))).toEqual([])
  })

  it('is offered exactly while it is safe', async () => {
    const { journal, task } = await completedOnce()

    expect(canUndoCompletion(await journal.occurrencesOf(task.id))).toBe(true)

    await journal.undoCompletion(task.id)
    expect(canUndoCompletion(await journal.occurrencesOf(task.id))).toBe(false)
  })

  it('reaches only the latest completion, one at a time', async () => {
    const { journal, clock, task } = await completedOnce()

    clock.set(new Date('2026-03-17T20:00:00'))
    await journal.completeTask(task.id)

    // The latest completion is 17 March, so this is the one that comes back —
    // 16 March stays historical while its successor is completed.
    const restored = await journal.undoCompletion(task.id)
    expect(restored.scheduledDate).toBe('2026-03-17')
    expect(
      (await journal.occurrencesOf(task.id)).map((one) => one.scheduledDate),
    ).toEqual(['2026-03-17', '2026-03-16'])
  })

  it('is refused for an older completion while a later one stands', async () => {
    const { journal, clock, task } = await completedOnce()

    clock.set(new Date('2026-03-17T20:00:00'))
    await journal.completeTask(task.id)

    // 18 March is Open and points back at 17 March, so 16 March is out of
    // reach: undoing it would open two occurrences at once.
    const occurrences = await journal.occurrencesOf(task.id)
    const open = openOccurrence(occurrences)!
    expect(open.scheduledDate).toBe('2026-03-18')
    expect(open.advancedFrom).toBe(
      completedOccurrences(occurrences)[0].id,
    )
    expect(completedOccurrences(occurrences)[1].scheduledDate).toBe('2026-03-16')
  })

  it('is refused once an edit has replaced the successor', async () => {
    const { journal, task } = await completedOnce()

    await journal.editTask(task.id, {
      description: 'water the plants',
      schedule: { date: '2026-03-19', time: null },
      recurrence: every(1, 'day'),
    })

    expect(canUndoCompletion(await journal.occurrencesOf(task.id))).toBe(false)
    await expect(journal.undoCompletion(task.id)).rejects.toThrow(/latest completion/)
  })

  it('is refused on a Task that never repeated', async () => {
    const { journal } = await journalAt('2026-03-16T08:00:00')
    const task = await journal.createTask('gym', { date: '2026-03-16', time: null })
    await journal.completeTask(task.id)

    await expect(journal.undoCompletion(task.id)).rejects.toThrow(/latest completion/)
  })
})

describe('the one-Open-occurrence invariant', () => {
  /**
   * A driver that fails partway through every transaction, exactly as an
   * interruption would: the statements before the failure have already run
   * inside SQLite's own transaction, so what survives is what a crash there
   * would leave behind.
   */
  function interrupted(driver: SqlDriver, after: number): SqlDriver {
    return {
      ...driver,
      transaction(statements: SqlStatement[]) {
        return driver.transaction([
          ...statements.slice(0, after),
          // A statement no schema will take: the transaction is refused from
          // inside, rather than never being started.
          { sql: 'INSERT INTO task_occurrences (id) VALUES (NULL)', params: [] },
          ...statements.slice(after),
        ])
      },
    }
  }

  it('the schema itself refuses a second Open occurrence', async () => {
    const { journal, driver } = await journalAt('2026-03-16T08:00:00')
    const task = await journal.createTask(
      'gym',
      { date: '2026-03-16', time: null },
      every(1, 'day'),
    )

    await expect(
      driver.execute(
        `INSERT INTO task_occurrences
           (id, task_id, scheduled_date, scheduled_time, completed_at, created_at, advanced_from)
         VALUES (?, ?, ?, NULL, NULL, ?, NULL)`,
        ['second', task.id, '2026-03-17', new Date().toISOString()],
      ),
    ).rejects.toThrow()

    expect(await openCount(driver, task.id)).toBe(1)
  })

  it('leaves exactly one Open occurrence when completing is interrupted', async () => {
    const { driver, clock } = await journalAt('2026-03-16T08:00:00')
    const journal = createJournal({ clock, driver })
    const task = await journal.createTask(
      'gym',
      { date: '2026-03-16', time: null },
      every(1, 'day'),
    )

    for (const after of [1, 2]) {
      const brittle = createJournal({ clock, driver: interrupted(driver, after) })
      await expect(brittle.completeTask(task.id)).rejects.toThrow()

      expect(await openCount(driver, task.id)).toBe(1)
      const occurrences = await journal.occurrencesOf(task.id)
      expect(occurrences).toHaveLength(1)
      expect(occurrences[0].scheduledDate).toBe('2026-03-16')
    }

    // And the ordinary path still works afterwards.
    expect((await journal.completeTask(task.id)).scheduledDate).toBe('2026-03-17')
  })

  it('leaves exactly one Open occurrence when undoing is interrupted', async () => {
    const { driver, clock } = await journalAt('2026-03-16T08:00:00')
    const journal = createJournal({ clock, driver })
    const task = await journal.createTask(
      'gym',
      { date: '2026-03-16', time: null },
      every(1, 'day'),
    )
    clock.set(new Date('2026-03-16T20:00:00'))
    await journal.completeTask(task.id)

    for (const after of [1, 2]) {
      const brittle = createJournal({ clock, driver: interrupted(driver, after) })
      await expect(brittle.undoCompletion(task.id)).rejects.toThrow()

      expect(await openCount(driver, task.id)).toBe(1)
      expect(canUndoCompletion(await journal.occurrencesOf(task.id))).toBe(true)
    }

    expect((await journal.undoCompletion(task.id)).scheduledDate).toBe('2026-03-16')
  })

  it('leaves the whole Task behind when deleting is interrupted', async () => {
    const { driver, clock } = await journalAt('2026-03-16T08:00:00')
    const journal = createJournal({ clock, driver })
    const task = await journal.createTask(
      'gym',
      { date: '2026-03-16', time: null },
      every(1, 'day'),
    )
    clock.set(new Date('2026-03-16T20:00:00'))
    await journal.completeTask(task.id)

    const brittle = createJournal({ clock, driver: interrupted(driver, 1) })
    await expect(brittle.deleteTask(task.id)).rejects.toThrow()

    expect((await journal.openTasks()).map((one) => one.id)).toEqual([task.id])
    expect(await journal.occurrencesOf(task.id)).toHaveLength(2)
  })
})

describe('deleting a Recurring Task', () => {
  it('takes its whole occurrence history with it', async () => {
    const { journal, clock, driver } = await journalAt('2026-03-16T08:00:00')
    const task = await journal.createTask(
      'gym',
      { date: '2026-03-16', time: null },
      every(1, 'day'),
    )
    clock.set(new Date('2026-03-16T20:00:00'))
    await journal.completeTask(task.id)

    await journal.deleteTask(task.id)

    expect(await journal.openTasks()).toEqual([])
    const rows = await driver.select<{ id: string }>(
      'SELECT id FROM task_occurrences',
      [],
    )
    expect(rows).toEqual([])
  })
})

describe('cadence across timezones and DST', () => {
  it('keeps the wall-clock time whatever the offset does', async () => {
    // 25 October 2026 is the day Lisbon's clocks go back.
    const { journal, clock } = await journalAt('2026-10-23T08:00:00')

    const task = await journal.createTask(
      'stand-up',
      { date: '2026-10-23', time: '09:00' },
      every(1, 'day'),
    )

    clock.set(new Date('2026-10-23T20:00:00'))
    const saturday = await journal.completeTask(task.id)
    expect(saturday.scheduledDate).toBe('2026-10-24')
    expect(saturday.scheduledTime).toBe('09:00')

    clock.set(new Date('2026-10-24T20:00:00'))
    const sunday = await journal.completeTask(task.id)
    // The day the clocks change is still one day later at the same wall clock.
    expect(sunday.scheduledDate).toBe('2026-10-25')
    expect(sunday.scheduledTime).toBe('09:00')
  })

  it('advances over a spring transition without losing a day', async () => {
    // 29 March 2026 is the day Lisbon's clocks go forward at 01:00.
    const { journal, clock } = await journalAt('2026-03-28T08:00:00')

    const task = await journal.createTask(
      'early start',
      { date: '2026-03-28', time: '01:30' },
      every(1, 'day'),
    )

    clock.set(new Date('2026-03-28T20:00:00'))
    const skipped = await journal.completeTask(task.id)

    expect(skipped.scheduledDate).toBe('2026-03-29')
    expect(skipped.scheduledTime).toBe('01:30')
  })

  it('follows the traveller: the same instant, a different civil day', () => {
    const daily = every(1, 'day')
    // 01:00 UTC on 17 March is 01:00 in Lisbon and 10:00 in Tokyo.
    const now = new Date('2026-03-17T01:00:00Z')

    expect(
      advancedSlot('2026-03-16', daily, '09:00', '2026-03-16', now, 'Europe/Lisbon'),
      // 09:00 on 17 March is still ahead of a traveller in Lisbon.
    ).toBe('2026-03-17')
    expect(
      advancedSlot('2026-03-16', daily, '09:00', '2026-03-16', now, 'Asia/Tokyo'),
      // The same instant in Tokyo is already past 09:00, so the next slot is.
    ).toBe('2026-03-18')
  })
})

describe('openingSlot and advancedSlot as pure calendar arithmetic', () => {
  const now = new Date('2026-03-16T10:00:00Z')

  it('opens a future series on its first slot', () => {
    expect(
      openingSlot('2026-04-01', every(1, 'month'), null, now, 'Europe/Lisbon'),
    ).toBe('2026-04-01')
  })

  it('opens a past series on its latest elapsed slot', () => {
    expect(
      openingSlot('2025-04-01', every(1, 'month'), null, now, 'Europe/Lisbon'),
    ).toBe('2026-03-01')
  })

  it('never goes backwards from the occurrence being completed', () => {
    expect(
      advancedSlot(
        '2026-01-01',
        every(1, 'day'),
        null,
        '2026-06-01',
        now,
        'Europe/Lisbon',
      ),
    ).toBe('2026-06-02')
  })
})

describe('sameRecurrence', () => {
  it('reads two identical cadences as one', () => {
    expect(sameRecurrence(every(2, 'week', [1, 3]), every(2, 'week', [1, 3]))).toBe(true)
    expect(sameRecurrence(null, null)).toBe(true)
  })

  it('tells apart the unit, the interval and the weekdays', () => {
    expect(sameRecurrence(every(1, 'week', [1]), every(1, 'day'))).toBe(false)
    expect(sameRecurrence(every(1, 'week', [1]), every(2, 'week', [1]))).toBe(false)
    expect(sameRecurrence(every(1, 'week', [1]), every(1, 'week', [1, 3]))).toBe(false)
    expect(sameRecurrence(every(1, 'day'), null)).toBe(false)
  })
})

describe('formatRecurrence', () => {
  it('says a cadence the way both the app and an export write it', () => {
    expect(formatRecurrence(every(1, 'day'))).toBe('every day')
    expect(formatRecurrence(every(3, 'day'))).toBe('every 3 days')
    expect(formatRecurrence(every(1, 'month'))).toBe('every month')
    expect(formatRecurrence(every(2, 'year'))).toBe('every 2 years')
    expect(formatRecurrence(every(1, 'week', [1]))).toBe('every week on Monday')
    expect(formatRecurrence(every(1, 'week', [1, 3]))).toBe(
      'every week on Monday and Wednesday',
    )
    expect(formatRecurrence(every(2, 'week', [1, 3, 5]))).toBe(
      'every 2 weeks on Monday, Wednesday and Friday',
    )
  })
})

describe('exporting a Recurring Task', () => {
  it('writes the cadence under the Task and its occurrences beneath it', async () => {
    const { journal, clock } = await journalAt('2026-03-16T08:00:00')

    const task = await journal.createTask(
      'water the plants',
      { date: '2026-03-16', time: '09:00' },
      every(1, 'day'),
    )
    clock.set(new Date('2026-03-16T20:00:00'))
    await journal.completeTask(task.id)

    const exported = await journal.exportJournal()

    expect(exported.markdown).toBe(
      [
        '# Tasks',
        '',
        '## Open',
        '- [ ] water the plants (scheduled 2026-03-17 09:00; repeats every day)',
        '  - occurrence 2026-03-16 09:00 (completed Mon 16 Mar, 20:00)',
      ].join('\n'),
    )
    // One Task, however many occurrences are under it.
    expect(exported.taskCount).toBe(1)
  })

  it('writes a date-only cadence without inventing a time', async () => {
    const { journal } = await journalAt('2026-03-16T08:00:00')

    await journal.createTask(
      'gym',
      { date: '2026-03-16', time: null },
      every(1, 'week', [1, 4]),
    )

    expect((await journal.exportJournal()).markdown).toContain(
      '- [ ] gym (scheduled 2026-03-16; repeats every week on Monday and Thursday)',
    )
  })

  it('writes an unscheduled Task that once repeated without a cadence', async () => {
    const { journal } = await journalAt('2026-03-16T08:00:00')

    const task = await journal.createTask(
      'gym',
      { date: '2026-03-16', time: null },
      every(1, 'day'),
    )
    await journal.editTask(task.id, { description: 'gym', schedule: null })

    expect((await journal.exportJournal()).markdown).toContain('## Open\n- [ ] gym')
  })
})
