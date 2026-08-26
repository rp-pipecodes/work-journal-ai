// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
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

function dateField(): HTMLInputElement {
  return screen.getByLabelText('Scheduled For') as HTMLInputElement
}

function timeField(): HTMLInputElement {
  return screen.getByLabelText('Time') as HTMLInputElement
}

function pick(control: HTMLInputElement, value: string) {
  fireEvent.change(control, { target: { value } })
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

  it('creates one Task from the Create control too', async () => {
    const journal = await openJournal()
    const desktop = fakeDesktop()

    showTaskCreation(desktop, journal)
    type('renew the TLS certificate')
    fireEvent.click(screen.getByRole('button', { name: 'Create Task' }))

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
  it('discards on a blur that leaves the window on screen — the user walked away', async () => {
    const journal = await openJournal()
    const desktop = fakeDesktop()

    showTaskCreation(desktop, journal)
    type('half a Task')
    desktop.blur()

    await expect.poll(() => desktop.taskCreationsDismissed).toBe(1)
    await expect.poll(() => field().value).toBe('')
  })

  it('keeps the description on a blur that came with the window being put away', async () => {
    const journal = await openJournal()
    const desktop = fakeDesktop()

    showTaskCreation(desktop, journal)
    type('half a Task')

    // What the Rust side does when the other Entry Point is invoked: this
    // window is hidden first, so the blur is a handoff rather than a walk-away.
    desktop.windowVisible = false
    desktop.blur()

    await expect.poll(() => field().value).toBe('half a Task')
    expect(desktop.taskCreationsDismissed).toBe(0)
  })

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

    // Half a Note, then the Task Entry Point, then half a Task, then back:
    // the sequence a user walks when a Task occurs to them mid-Capture. Each
    // Entry Point puts the other window away and raises its own, so both
    // views see their window shown again with text still waiting in them.
    fireEvent.change(capture, { target: { value: 'half a Note' } })
    await act(async () => desktop.showTaskCreation())
    type('half a Task')
    await act(async () => desktop.beginCapture())

    // Asserted after a flush, not polled: what is being claimed is that these
    // never change, and a poll would read them before a wipe had landed and
    // pass on a value that was about to go.
    expect(capture.value).toBe('half a Note')
    expect(field().value).toBe('half a Task')
  })
})

describe('scheduling a Task as it is created', () => {
  it('commits the date and the time chosen', async () => {
    const journal = await openJournal()
    const desktop = fakeDesktop()
    showTaskCreation(desktop, journal)

    type('renew the TLS certificate')
    pick(dateField(), '2026-03-16')
    pick(timeField(), '14:00')
    pressEnter()

    await expect.poll(async () => await journal.openTasks()).toHaveLength(1)
    const [task] = await journal.openTasks()
    expect(task.description).toBe('renew the TLS certificate')
    expect(task.scheduledDate).toBe('2026-03-16')
    expect(task.scheduledTime).toBe('14:00')
  })

  it('commits an Unscheduled Task when no date is chosen', async () => {
    const journal = await openJournal()
    const desktop = fakeDesktop()
    showTaskCreation(desktop, journal)

    type('someday')
    pressEnter()

    await expect.poll(async () => await journal.openTasks()).toHaveLength(1)
    const [task] = await journal.openTasks()
    expect(task.scheduledDate).toBeNull()
    expect(task.scheduledTime).toBeNull()
  })

  it('has no time until there is a date for it to be a minute of', async () => {
    showTaskCreation(fakeDesktop(), await openJournal())

    expect(timeField().disabled).toBe(true)

    pick(dateField(), '2026-03-16')

    expect(timeField().disabled).toBe(false)
  })

  it('clears the time along with the date', async () => {
    const journal = await openJournal()
    showTaskCreation(fakeDesktop(), journal)
    type('renew it')
    pick(dateField(), '2026-03-16')
    pick(timeField(), '14:00')

    fireEvent.click(screen.getByRole('button', { name: 'Clear the schedule' }))

    expect(dateField().value).toBe('')
    expect(timeField().value).toBe('')
    expect(timeField().disabled).toBe(true)
  })

  it('leaves the description exactly as typed, schedule words and all', async () => {
    const journal = await openJournal()
    showTaskCreation(fakeDesktop(), journal)

    type('ship it tomorrow at 9am')
    pressEnter()

    await expect.poll(async () => await journal.openTasks()).toHaveLength(1)
    const [task] = await journal.openTasks()
    expect(task.description).toBe('ship it tomorrow at 9am')
    expect(task.scheduledDate).toBeNull()
  })

  it('starts the next Task Creation Unscheduled, whether it committed or not', async () => {
    const journal = await openJournal()
    const desktop = fakeDesktop()
    showTaskCreation(desktop, journal)

    type('renew it')
    pick(dateField(), '2026-03-16')
    pressEnter()

    await expect.poll(() => dateField().value).toBe('')
    expect(field().value).toBe('')

    type('abandoned')
    pick(dateField(), '2026-03-20')
    pressEscape()

    await expect.poll(() => dateField().value).toBe('')
  })

  it('asks about Task Alerts once a Task with a time is committed', async () => {
    const journal = await openJournal()
    const desktop = fakeDesktop({ alertPermission: 'undetermined' })
    showTaskCreation(desktop, journal)

    type('renew it')
    pick(dateField(), '2026-03-16')
    pick(timeField(), '14:00')
    pressEnter()

    await expect.poll(() => desktop.alertPrompted).toBe(true)
  })

  it('never asks for a Task with a date and no time', async () => {
    const journal = await openJournal()
    const desktop = fakeDesktop({ alertPermission: 'undetermined' })
    showTaskCreation(desktop, journal)

    type('renew it')
    pick(dateField(), '2026-03-16')
    pressEnter()

    await expect.poll(async () => await journal.openTasks()).toHaveLength(1)
    expect(desktop.alertPrompted).toBe(false)
  })

  it('commits the Task before the window goes, and asks afterwards', async () => {
    const journal = await openJournal()
    const desktop = fakeDesktop({ alertPermission: 'denied' })
    showTaskCreation(desktop, journal)

    type('renew it')
    pick(dateField(), '2026-03-16')
    pick(timeField(), '14:00')
    pressEnter()

    // Refused by macOS, and the Task is stored all the same.
    await expect.poll(() => desktop.taskCreationsDismissed).toBe(1)
    expect((await journal.openTasks())[0].scheduledTime).toBe('14:00')
  })
})

describe('repeating a Task as it is created', () => {
  function cadenceField(): HTMLSelectElement {
    return screen.getByLabelText('Repeats') as HTMLSelectElement
  }

  it('has no cadence until there is a date to count it from', async () => {
    showTaskCreation(fakeDesktop(), await openJournal())

    expect(cadenceField().disabled).toBe(true)

    pick(dateField(), '2026-03-16')

    expect(cadenceField().disabled).toBe(false)
  })

  it('commits the cadence chosen beside the date', async () => {
    const journal = await openJournal()
    showTaskCreation(fakeDesktop(), journal)

    type('water the plants')
    pick(dateField(), '2026-03-16')
    fireEvent.change(cadenceField(), { target: { value: 'day' } })
    fireEvent.change(
      screen.getByLabelText('How many days between occurrences'),
      { target: { value: '3' } },
    )
    pressEnter()

    await expect.poll(async () => await journal.openTasks()).toHaveLength(1)
    const [task] = await journal.openTasks()
    expect(task.recurrence).toEqual({ unit: 'day', interval: 3, weekdays: [] })
    expect(task.recurrenceAnchor).toBe('2026-03-16')
  })

  it('takes a fractional interval as the whole unit it has to be', async () => {
    const journal = await openJournal()
    showTaskCreation(fakeDesktop(), journal)

    type('water the plants')
    pick(dateField(), '2026-03-16')
    fireEvent.change(cadenceField(), { target: { value: 'day' } })
    // A cadence counts calendar units, so half of one is refused by the
    // control rather than by the save that would otherwise fail.
    fireEvent.change(
      screen.getByLabelText('How many days between occurrences'),
      { target: { value: '1.5' } },
    )
    pressEnter()

    await expect.poll(async () => await journal.openTasks()).toHaveLength(1)
    expect((await journal.openTasks())[0].recurrence).toEqual({
      unit: 'day',
      interval: 2,
      weekdays: [],
    })
  })

  it('commits a weekly cadence on several weekdays', async () => {
    const journal = await openJournal()
    showTaskCreation(fakeDesktop(), journal)

    type('gym')
    // 16 March 2026 is a Monday.
    pick(dateField(), '2026-03-16')
    fireEvent.change(cadenceField(), { target: { value: 'week' } })
    fireEvent.click(screen.getByRole('button', { name: 'Wednesday' }))
    pressEnter()

    await expect.poll(async () => await journal.openTasks()).toHaveLength(1)
    expect((await journal.openTasks())[0].recurrence?.weekdays).toEqual([1, 3])
  })

  it('clears the cadence along with the date', async () => {
    showTaskCreation(fakeDesktop(), await openJournal())
    type('water the plants')
    pick(dateField(), '2026-03-16')
    fireEvent.change(cadenceField(), { target: { value: 'day' } })

    fireEvent.click(screen.getByRole('button', { name: 'Clear the schedule' }))

    expect(cadenceField().value).toBe('none')
    expect(cadenceField().disabled).toBe(true)
  })

  it('leaves the next Task Creation with no cadence at all', async () => {
    const journal = await openJournal()
    showTaskCreation(fakeDesktop(), journal)

    type('water the plants')
    pick(dateField(), '2026-03-16')
    fireEvent.change(cadenceField(), { target: { value: 'week' } })
    pressEnter()

    await expect.poll(async () => await journal.openTasks()).toHaveLength(1)
    await expect.poll(() => cadenceField().value).toBe('none')
    expect(dateField().value).toBe('')
  })
})
