// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { fakeDesktop } from '@/platform/testing/desktop'
import { createJournal, formatJournalDay } from '@/journal/journal'
import { fixedClock, openTestDatabase } from '@/journal/testing/database'
import StandupPostView from './StandupPostView'

const openDatabases: Array<() => void> = []

afterEach(() => {
  cleanup()
  for (const close of openDatabases.splice(0)) close()
})

async function standupPostAt() {
  const { driver, close } = await openTestDatabase()
  openDatabases.push(close)
  const clock = fixedClock('2026-03-12T09:00:00')
  const journal = createJournal({ clock, driver })
  const desktop = fakeDesktop({ driver })
  return { clock, desktop, journal }
}

describe('Standup Post section', () => {
  it('shows yesterday’s date and the counts for both halves', async () => {
    const { journal, clock, desktop } = await standupPostAt()

    clock.set(new Date('2026-03-11T09:00:00'))
    await journal.capture('yesterday')
    const completed = await journal.createTask('completed yesterday')
    await journal.completeTask(completed.id)

    clock.set(new Date('2026-03-12T09:00:00'))
    await journal.createTask('overdue', { date: '2026-03-10', time: null })
    await journal.createTask('today', { date: '2026-03-12', time: '17:00' })
    await journal.createTask('upcoming', { date: '2026-03-13', time: null })

    render(
      <StandupPostView
        desktop={desktop}
        journal={Promise.resolve(journal)}
        clock={clock}
      />,
    )

    expect(
      await screen.findByText(
        `Yesterday: ${formatJournalDay('2026-03-11')}`,
      ),
    ).toBeTruthy()
    expect(await screen.findByText('1 Note')).toBeTruthy()
    expect(await screen.findByText('1 Completed Task')).toBeTruthy()
    expect(await screen.findByText('2 Open Tasks')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Generate/i })).toBeTruthy()
  })

  it('says Nothing to say when both halves are empty', async () => {
    const { clock, desktop, journal } = await standupPostAt()

    render(
      <StandupPostView
        desktop={desktop}
        journal={Promise.resolve(journal)}
        clock={clock}
      />,
    )

    expect(await screen.findByText('Nothing to say yet.')).toBeTruthy()
    expect(screen.getByText('0 Notes')).toBeTruthy()
    expect(screen.getByText('0 Completed Tasks')).toBeTruthy()
    expect(screen.getByText('0 Open Tasks')).toBeTruthy()
  })
})
