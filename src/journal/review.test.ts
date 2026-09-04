import { afterEach, describe, expect, it } from 'vitest'
import {
  createJournal,
  formatSlot,
  isOpen,
  slotOf,
  type Journal,
} from './journal'
import { fixedClock, openTestDatabase } from './testing/database'
import { formatDayRange } from '@/views/history/range-label'
import {
  buildReviewMaterial,
  reviewRefuses,
  selectReview,
} from './review'

// Review Material is tested at the Journal boundary like Standup Material:
// real SQL proves the selection reads the records the Filter describes,
// while the clock makes day boundaries deterministic.

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

describe('selectReview', () => {
  it('selects the Filter’s Notes and the work completed in its days', async () => {
    const { journal, clock } = await journalAt('2026-03-13T09:00:00')

    clock.set(new Date('2026-03-09T10:00:00'))
    await journal.capture('monday note')
    const keptMonday = await journal.createTask('kept monday')
    await journal.completeTask(keptMonday.id)

    clock.set(new Date('2026-03-11T10:00:00'))
    await journal.capture('wednesday note')
    const keptWednesday = await journal.createTask('kept wednesday')
    await journal.completeTask(keptWednesday.id)

    clock.set(new Date('2026-03-12T10:00:00'))
    await journal.capture('thursday note')
    const keptThursday = await journal.createTask('kept thursday')
    await journal.completeTask(keptThursday.id)

    const selected = await selectReview({
      journal,
      filter: { from: '2026-03-09', to: '2026-03-11' },
    })

    expect(selected.digest.markdown).toContain('monday note')
    expect(selected.digest.markdown).toContain('wednesday note')
    expect(selected.digest.markdown).not.toContain('thursday note')
    expect(selected.digest.noteCount).toBe(2)
    expect(
      selected.completedTasks.map((task) => task.description).sort(),
    ).toEqual(['kept monday', 'kept wednesday'])
    expect(selected.completedOccurrences).toEqual([])
  })

  it('keeps completions on both inclusive boundaries', async () => {
    const { journal, clock } = await journalAt('2026-03-09T08:00:00')

    clock.set(new Date('2026-03-09T00:10:00'))
    const first = await journal.createTask('first boundary')
    await journal.completeTask(first.id)

    clock.set(new Date('2026-03-11T23:50:00'))
    const last = await journal.createTask('last boundary')
    await journal.completeTask(last.id)

    clock.set(new Date('2026-03-08T10:00:00'))
    const before = await journal.createTask('before')
    await journal.completeTask(before.id)

    clock.set(new Date('2026-03-12T00:10:00'))
    const after = await journal.createTask('after')
    await journal.completeTask(after.id)

    const selected = await selectReview({
      journal,
      filter: { from: '2026-03-09', to: '2026-03-11' },
    })

    expect(
      selected.completedTasks.map((task) => task.description).sort(),
    ).toEqual(['first boundary', 'last boundary'])
  })

  it('files an ordinary Task and an occurrence completed at the same instant after local midnight under the same day', async () => {
    // July: Europe/Lisbon is at UTC+1, so 00:30 local on the 2nd is stored
    // 2026-07-01T23:30Z. Both records kept at that instant belong to the 2nd.
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

    const selected = await selectReview({
      journal,
      filter: { from: '2026-07-02', to: '2026-07-02' },
    })

    expect(selected.completedTasks.map((task) => task.description)).toEqual([
      'the ordinary one',
    ])
    expect(selected.completedOccurrences).toHaveLength(1)
    expect(
      formatSlot(slotOf(selected.completedOccurrences[0].occurrence)),
    ).toBe('2026-07-01 23:00')
  })

  it('selects occurrences completed in the range with their parent Tasks, never completing the parent', async () => {
    const { journal, clock } = await journalAt('2026-03-09T08:00:00')
    const daily = await journal.createTask(
      'water the plants',
      { date: '2026-03-09', time: '09:00' },
      { unit: 'day', interval: 1, weekdays: [] },
    )

    clock.set(new Date('2026-03-09T10:00:00'))
    await journal.completeTask(daily.id)

    clock.set(new Date('2026-03-13T09:00:00'))
    await journal.editTask(daily.id, {
      description: 'water the plants',
      schedule: { date: '2026-03-16', time: '09:00' },
    })

    const selected = await selectReview({
      journal,
      filter: { from: '2026-03-09', to: '2026-03-11' },
    })

    expect(selected.completedOccurrences).toHaveLength(1)
    expect(selected.completedOccurrences[0].occurrence.taskId).toBe(daily.id)
    expect(isOpen(selected.completedOccurrences[0].task)).toBe(true)
    expect(selected.completedTasks).toEqual([])
  })

  it('keeps the occurrence history of a stopped recurrence', async () => {
    const { journal, clock } = await journalAt('2026-03-09T08:00:00')
    const daily = await journal.createTask(
      'water the plants',
      { date: '2026-03-09', time: '09:00' },
      { unit: 'day', interval: 1, weekdays: [] },
    )

    clock.set(new Date('2026-03-09T10:00:00'))
    await journal.completeTask(daily.id)

    // Stopping the recurrence keeps the Task and its kept history.
    clock.set(new Date('2026-03-10T09:00:00'))
    await journal.editTask(daily.id, {
      description: 'water the plants',
      schedule: { date: '2026-03-10', time: '09:00' },
      recurrence: null,
    })

    const selected = await selectReview({
      journal,
      filter: { from: '2026-03-09', to: '2026-03-11' },
    })

    expect(selected.completedOccurrences).toHaveLength(1)
    expect(
      formatSlot(slotOf(selected.completedOccurrences[0].occurrence)),
    ).toBe('2026-03-09 09:00')
  })

  it('orders completions oldest-first across both record types, deterministically', async () => {
    const { journal, clock } = await journalAt('2026-03-09T08:00:00')
    const daily = await journal.createTask(
      'water the plants',
      { date: '2026-03-09', time: '09:00' },
      { unit: 'day', interval: 1, weekdays: [] },
    )

    clock.set(new Date('2026-03-09T09:15:00'))
    await journal.completeTask(daily.id)
    clock.set(new Date('2026-03-09T18:00:00'))
    const ordinary = await journal.createTask('chase the invoice')
    await journal.completeTask(ordinary.id)

    clock.set(new Date('2026-03-13T09:00:00'))
    await journal.editTask(daily.id, {
      description: 'water the plants',
      schedule: { date: '2026-03-16', time: '09:00' },
    })

    const first = await selectReview({
      journal,
      filter: { from: '2026-03-09', to: '2026-03-09' },
    })
    const second = await selectReview({
      journal,
      filter: { from: '2026-03-09', to: '2026-03-09' },
    })

    const material = buildReviewMaterial(first)
    const lines = material.markdown
      .split('\n')
      .filter((line) => line.startsWith('- [x]'))
    // Oldest completion first: the occurrence kept at 09:15, then the Task
    // completed at 18:00 — the reverse of Standup Material's newest-first.
    expect(lines).toEqual([
      '- [x] water the plants (occurrence 2026-03-09 09:00)',
      '- [x] chase the invoice',
    ])
    // Deterministic: the same range reads the same way twice.
    expect(buildReviewMaterial(second).markdown).toBe(material.markdown)
  })
})

describe('buildReviewMaterial', () => {
  it('embeds the Filter’s Digest verbatim under one heading naming the range, then the Completed section', async () => {
    const { journal, clock } = await journalAt('2026-03-12T09:00:00')

    clock.set(new Date('2026-03-11T09:00:00'))
    await journal.capture('#ops shipped the migration')
    clock.set(new Date('2026-03-11T09:05:00'))
    await journal.capture('plain note')
    const completed = await journal.createTask('kept yesterday')
    await journal.completeTask(completed.id)

    clock.set(new Date('2026-03-12T09:00:00'))

    const selection = await selectReview({
      journal,
      filter: { from: '2026-03-11', to: '2026-03-11' },
    })
    const material = buildReviewMaterial(selection)
    const digest = await journal.digest({
      from: '2026-03-11',
      to: '2026-03-11',
    })

    // One top-level heading names the range; the Digest follows verbatim —
    // `#project` prefixes and all — so the two can never disagree.
    expect(material.markdown).toContain(digest.markdown)
    expect(material.markdown).toBe(
      `# ${formatDayRange('2026-03-11', '2026-03-11')}\n\n${digest.markdown}\n\n## Completed\n- [x] kept yesterday`,
    )
    expect(material.noteCount).toBe(2)
    expect(material.completionCount).toBe(1)
  })

  it('day-groups completions under the same headings when the range spans more than one day', async () => {
    const { journal, clock } = await journalAt('2026-03-13T09:00:00')

    clock.set(new Date('2026-03-09T10:00:00'))
    await journal.capture('monday note')
    const monday = await journal.createTask('kept monday')
    await journal.completeTask(monday.id)

    clock.set(new Date('2026-03-11T10:00:00'))
    await journal.capture('wednesday note')
    const wednesday = await journal.createTask('kept wednesday')
    await journal.completeTask(wednesday.id)

    const selection = await selectReview({
      journal,
      filter: { from: '2026-03-09', to: '2026-03-11' },
    })
    const material = buildReviewMaterial(selection)

    expect(material.markdown).toBe(
      `# ${formatDayRange('2026-03-09', '2026-03-11')}\n` +
        `\n## Mon 9 Mar\n- monday note\n\n## Wed 11 Mar\n- wednesday note\n\n` +
        `## Completed\n### Mon 9 Mar\n- [x] kept monday\n### Wed 11 Mar\n- [x] kept wednesday`,
    )
  })

  it('renders a completed occurrence as one checked bullet carrying its slot, never the parent as completed', async () => {
    const { journal, clock } = await journalAt('2026-03-09T08:00:00')
    const daily = await journal.createTask(
      'Water the plants',
      { date: '2026-03-09', time: '09:00' },
      { unit: 'day', interval: 1, weekdays: [] },
    )

    clock.set(new Date('2026-03-09T10:00:00'))
    await journal.completeTask(daily.id)
    clock.set(new Date('2026-03-13T09:00:00'))
    await journal.editTask(daily.id, {
      description: 'Water the plants',
      schedule: { date: '2026-03-16', time: '09:00' },
    })

    const selection = await selectReview({
      journal,
      filter: { from: '2026-03-09', to: '2026-03-09' },
    })
    const material = buildReviewMaterial(selection)

    expect(material.markdown).toBe(
      `# ${formatDayRange('2026-03-09', '2026-03-09')}\n\n## Completed\n- [x] Water the plants (occurrence 2026-03-09 09:00)`,
    )
  })

  it('copies a range whose only content is completed work, with no empty Notes section', async () => {
    const { journal, clock } = await journalAt('2026-03-12T09:00:00')

    clock.set(new Date('2026-03-11T09:00:00'))
    const completed = await journal.createTask('kept yesterday')
    await journal.completeTask(completed.id)
    clock.set(new Date('2026-03-12T09:00:00'))

    const selection = await selectReview({
      journal,
      filter: { from: '2026-03-11', to: '2026-03-11' },
    })

    expect(reviewRefuses(selection)).toBe(false)
    expect(buildReviewMaterial(selection).markdown).toBe(
      `# ${formatDayRange('2026-03-11', '2026-03-11')}\n\n## Completed\n- [x] kept yesterday`,
    )
  })

  it('produces a clear empty result for a range with neither Notes nor completions', async () => {
    const { journal } = await journalAt('2026-03-13T09:00:00')

    const selection = await selectReview({
      journal,
      filter: { from: '2026-03-09', to: '2026-03-11' },
    })

    expect(reviewRefuses(selection)).toBe(true)
    const material = buildReviewMaterial(selection)
    expect(material.noteCount).toBe(0)
    expect(material.completionCount).toBe(0)
    expect(material.markdown).toContain(
      `# ${formatDayRange('2026-03-09', '2026-03-11')}`,
    )
    expect(material.markdown).toContain('Nothing to review')
  })
})

describe('reviewRefuses', () => {
  it('refuses only a range with neither half', async () => {
    const { journal, clock } = await journalAt('2026-03-13T09:00:00')

    const empty = await selectReview({
      journal,
      filter: { from: '2026-03-09', to: '2026-03-11' },
    })
    expect(reviewRefuses(empty)).toBe(true)

    clock.set(new Date('2026-03-09T10:00:00'))
    await journal.capture('a note')
    const notesOnly = await selectReview({
      journal,
      filter: { from: '2026-03-09', to: '2026-03-11' },
    })
    expect(reviewRefuses(notesOnly)).toBe(false)

    const completed = await journal.createTask('kept')
    await journal.completeTask(completed.id)
    const both = await selectReview({
      journal,
      filter: { from: '2026-03-09', to: '2026-03-11' },
    })
    expect(reviewRefuses(both)).toBe(false)
  })

  it('does not refuse a range whose only content is a completed occurrence', async () => {
    const { journal, clock } = await journalAt('2026-03-12T09:00:00')
    const daily = await journal.createTask(
      'water the plants',
      { date: '2026-03-10', time: '09:00' },
      { unit: 'day', interval: 1, weekdays: [] },
    )

    clock.set(new Date('2026-03-11T09:15:00'))
    await journal.completeTask(daily.id)
    clock.set(new Date('2026-03-12T09:00:00'))

    const onlyAnOccurrence = await selectReview({
      journal,
      filter: { from: '2026-03-11', to: '2026-03-11' },
    })
    expect(reviewRefuses(onlyAnOccurrence)).toBe(false)
  })
})
