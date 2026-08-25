// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { fakeDesktop, type FakeDesktop } from '@/platform/testing/desktop'
import { createJournal, type Journal } from '@/journal/journal'
import { fixedClock, openTestDatabase } from '@/journal/testing/database'
import CaptureView from '../capture/CaptureView'
import TaskCreationView from './TaskCreationView'

// The Task Creation as the user meets it. What Enter and Escape mean, what a
// refusal leaves on screen, and that an unfinished Capture is untouched by any
// of it are all decided here, so this is where they have to be pressed.

afterEach(cleanup)

async function openJournal(): Promise<Journal> {
  const { driver } = await openTestDatabase()
  return createJournal({ clock: fixedClock('2026-03-02T09:00:00'), driver })
}

/** A journal that cannot store anything — every Task Creation is refused. */
function refusingJournal(journal: Journal): Journal {
  return {
    ...journal,
    createTask: () => Promise.reject(new Error('the disk is gone')),
  }
}

function showTaskCreation(desktop: FakeDesktop, journal: Journal) {
  render(
    <TaskCreationView desktop={desktop} journal={Promise.resolve(journal)} />,
  )
}

function field(): HTMLInputElement {
  return screen.getByLabelText('What do you need to do?') as HTMLInputElement
}

function type(text: string) {
  fireEvent.change(field(), { target: { value: text } })
}

function pressEnter() {
  fireEvent.keyDown(field(), { key: 'Enter' })
}

function pressEscape() {
  fireEvent.keyDown(field(), { key: 'Escape' })
}

describe('committing a Task', () => {
  it('creates one Task and dismisses the window', async () => {
    const journal = await openJournal()
    const desktop = fakeDesktop()

    showTaskCreation(desktop, journal)
    type('renew the TLS certificate')
    pressEnter()

    await expect.poll(() => desktop.taskCreationsDismissed).toBe(1)
    expect((await journal.openTasks()).map((task) => task.description)).toEqual([
      'renew the TLS certificate',
    ])
  })

  it('leaves the next Task Creation empty', async () => {
    const journal = await openJournal()
    const desktop = fakeDesktop()

    showTaskCreation(desktop, journal)
    type('renew the TLS certificate')
    pressEnter()

    await expect.poll(() => desktop.taskCreationsDismissed).toBe(1)
    expect(field().value).toBe('')
  })

  it('tells the rest of the app before the window goes', async () => {
    const journal = await openJournal()
    const desktop = fakeDesktop()
    let heard = 0
    await desktop.onTasksChanged(() => {
      heard += 1
    })

    showTaskCreation(desktop, journal)
    type('renew the TLS certificate')
    pressEnter()

    await expect.poll(() => heard).toBe(1)
  })

  it('commits nothing at all for an empty or blank description', async () => {
    const journal = await openJournal()
    const desktop = fakeDesktop()

    showTaskCreation(desktop, journal)
    pressEnter()
    type('   ')
    pressEnter()

    expect(desktop.taskCreationsDismissed).toBe(0)
    expect(await journal.openTasks()).toEqual([])
  })
})

describe('abandoning a Task Creation', () => {
  it('commits nothing and leaves the next one empty', async () => {
    const journal = await openJournal()
    const desktop = fakeDesktop()

    showTaskCreation(desktop, journal)
    type('renew the TLS certificate')
    pressEscape()

    await expect.poll(() => desktop.taskCreationsDismissed).toBe(1)
    expect(field().value).toBe('')
    expect(await journal.openTasks()).toEqual([])
  })
})

describe('an Entry Point reached while the window is already up', () => {
  it('focuses the field without clearing what is in it', async () => {
    const journal = await openJournal()
    const desktop = fakeDesktop()

    showTaskCreation(desktop, journal)
    type('half a thought')
    field().blur()

    desktop.showTaskCreation()

    expect(field().value).toBe('half a thought')
    expect(document.activeElement).toBe(field())
  })
})

describe('a Task the record refused', () => {
  it('keeps the description on screen and says what did not happen', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const journal = await openJournal()
    const desktop = fakeDesktop()

    showTaskCreation(desktop, refusingJournal(journal))
    type('renew the TLS certificate')
    pressEnter()

    const problem = await screen.findByRole('alert')
    expect(problem.textContent).toContain('could not be stored')
    expect(field().value).toBe('renew the TLS certificate')
    expect(desktop.taskCreationsDismissed).toBe(0)
    // The window grows to hold the refusal rather than squeezing the field.
    await expect.poll(() => desktop.taskCreationFits.at(-1)).toBe(true)
  })
})

describe('the two resident windows', () => {
  it('leaves an unfinished Capture untouched, and the other way round', async () => {
    const journal = await openJournal()
    const desktop = fakeDesktop()

    render(
      <>
        <CaptureView desktop={desktop} journal={Promise.resolve(journal)} />
        <TaskCreationView desktop={desktop} journal={Promise.resolve(journal)} />
      </>,
    )

    const capture = screen.getByLabelText(
      'What did you just do?',
    ) as HTMLInputElement
    fireEvent.change(capture, { target: { value: 'half a Note' } })
    type('half a Task')

    // Either Entry Point, reached again, changes nothing in the other window.
    desktop.beginCapture()
    desktop.showTaskCreation()

    expect(capture.value).toBe('half a Note')
    expect(field().value).toBe('half a Task')
  })
})
