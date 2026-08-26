// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { fakeDesktop } from '@/platform/testing/desktop'
import { createJournal, type Task } from '@/journal/journal'
import { fixedClock, openTestDatabase } from '@/journal/testing/database'
import TasksView from './TasksView'

// Tasks View as the user meets it: the two lists, the checkbox that completes
// without asking, the Editor that discards on Cancel, and the confirmation on
// the one thing that cannot be undone.

afterEach(cleanup)

const openDatabases: Array<() => void> = []

afterEach(() => {
  for (const close of openDatabases.splice(0)) close()
})

/** Tasks View over a real journal, already showing its first list. */
async function showTasks(descriptions: string[] = []) {
  const { driver, close } = await openTestDatabase()
  openDatabases.push(close)

  const clock = fixedClock('2026-03-09T09:00:00')
  const core = createJournal({ clock, driver })

  const created: Task[] = []
  for (const [index, description] of descriptions.entries()) {
    clock.set(new Date(`2026-03-09T${String(9 + index).padStart(2, '0')}:00:00`))
    created.push(await core.createTask(description))
  }

  const desktop = fakeDesktop({ driver })
  render(<TasksView desktop={desktop} journal={Promise.resolve(core)} />)

  return { desktop, core, clock, created }
}

/** The list as it reads on screen, in the order the rows are in. */
function rows(): string[] {
  return [...document.querySelectorAll('li button[type="button"]')]
    .filter((button) => button.getAttribute('aria-label') === null)
    .map((button) => button.textContent ?? '')
}

function tab(name: 'Open' | 'Completed'): HTMLElement {
  return screen.getByRole('button', { name })
}

describe('opening Tasks View', () => {
  it('opens on the Open Tasks, newest first', async () => {
    await showTasks(['first', 'second', 'third'])

    await screen.findByText('third')
    expect(rows()).toEqual(['third', 'second', 'first'])
  })

  it('teaches the Task Hotkey when there is nothing owed yet', async () => {
    await showTasks()

    const empty = await screen.findByRole('heading', { name: 'No Open Tasks' })
    const section = empty.closest('section')!
    expect(
      [...section.querySelectorAll('kbd[data-slot="kbd"]')].map(
        (key) => key.textContent,
      ),
    ).toEqual(['Ctrl', 'Shift', 'Cmd', 'T'])
  })

  it('says the Completed list is empty in its own words', async () => {
    await showTasks()
    await screen.findByRole('heading', { name: 'No Open Tasks' })

    fireEvent.click(tab('Completed'))

    await screen.findByRole('heading', { name: 'No Completed Tasks yet' })
  })
})

describe('completing and reopening', () => {
  it('completes from the checkbox with no confirmation at all', async () => {
    const { core } = await showTasks(['renew the certificate'])
    await screen.findByText('renew the certificate')

    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Complete “renew the certificate”' }),
    )

    await expect.poll(() => rows()).toEqual([])
    expect(await core.completedTasks()).toHaveLength(1)
    // Nothing was asked: no dialog stood between the press and the change.
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('reopens a Completed Task from the Completed list', async () => {
    const { core } = await showTasks(['renew the certificate'])
    fireEvent.click(
      await screen.findByRole('checkbox', {
        name: 'Complete “renew the certificate”',
      }),
    )
    await expect.poll(() => rows()).toEqual([])

    fireEvent.click(tab('Completed'))
    const checkbox = await screen.findByRole('checkbox', {
      name: 'Reopen “renew the certificate”',
    })
    fireEvent.click(checkbox)

    await expect.poll(() => rows()).toEqual([])
    expect(await core.openTasks()).toHaveLength(1)
  })
})

describe('the Task Editor', () => {
  it('saves a reworded Task', async () => {
    const { core } = await showTasks(['renew the cert'])
    fireEvent.click(await screen.findByText('renew the cert'))

    const editor = await screen.findByRole('dialog', { name: 'Edit Task' })
    const input = screen.getByLabelText('Task Description') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'renew the TLS certificate' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await expect.poll(() => rows()).toEqual(['renew the TLS certificate'])
    expect(editor.isConnected).toBe(false)
    expect(
      (await core.openTasks()).map((task) => task.description),
    ).toEqual(['renew the TLS certificate'])
  })

  it('discards on Cancel', async () => {
    const { core } = await showTasks(['renew the cert'])
    fireEvent.click(await screen.findByText('renew the cert'))

    const input = screen.getByLabelText('Task Description') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'something else entirely' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(rows()).toEqual(['renew the cert'])
    expect((await core.openTasks())[0].description).toBe('renew the cert')
  })

  it('discards on Escape, and does not close the window with it', async () => {
    const { desktop, core } = await showTasks(['renew the cert'])
    let closed = 0
    desktop.closeWindow = async () => {
      closed += 1
    }
    fireEvent.click(await screen.findByText('renew the cert'))

    const input = screen.getByLabelText('Task Description') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'something else entirely' } })
    fireEvent.keyDown(input, { key: 'Escape' })

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(closed).toBe(0)
    expect((await core.openTasks())[0].description).toBe('renew the cert')
  })

  it('never reuses the Task Creation window', async () => {
    const { desktop } = await showTasks(['renew the cert'])
    fireEvent.click(await screen.findByText('renew the cert'))

    await screen.findByRole('dialog', { name: 'Edit Task' })
    expect(desktop.taskCreationsBegun).toBe(0)
  })
})

describe('deleting a Task', () => {
  it('always asks first, and removes it once confirmed', async () => {
    const { core } = await showTasks(['renew the cert'])
    await screen.findByText('renew the cert')

    fireEvent.click(
      screen.getByRole('button', { name: 'Delete “renew the cert”' }),
    )

    const confirm = await screen.findByRole('button', { name: 'Delete' })
    expect(await core.openTasks()).toHaveLength(1)

    fireEvent.click(confirm)

    await expect.poll(() => rows()).toEqual([])
    expect(await core.openTasks()).toEqual([])
  })
})

describe('New Task', () => {
  it('reaches the same resident Task Creation window every Entry Point does', async () => {
    const { desktop } = await showTasks()
    await screen.findByRole('heading', { name: 'No Open Tasks' })

    fireEvent.click(screen.getByRole('button', { name: 'New Task' }))

    expect(desktop.taskCreationsBegun).toBe(1)
  })
})

describe('a Task changed elsewhere', () => {
  it('shows up with no manual refresh', async () => {
    const { desktop, core, clock } = await showTasks(['already here'])
    await screen.findByText('already here')

    clock.set(new Date('2026-03-09T14:00:00'))
    await core.createTask('typed in the Task Creation window')
    await desktop.announceTasksChanged()

    await expect
      .poll(() => rows())
      .toEqual(['typed in the Task Creation window', 'already here'])
  })
})

describe('Escape', () => {
  it('closes the window when nothing has taken the screen over', async () => {
    const { desktop } = await showTasks(['renew the cert'])
    let closed = 0
    desktop.closeWindow = async () => {
      closed += 1
    }
    await screen.findByText('renew the cert')

    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: 'Escape',
    })

    expect(closed).toBe(1)
  })
})

/** Tasks View is one of the windows with an overlay title bar. */
describe('the window chrome', () => {
  it('keeps a strip above everything for the traffic lights to sit in', async () => {
    await showTasks()
    await screen.findByRole('heading', { name: 'No Open Tasks' })

    const strip = document.querySelector<HTMLElement>(
      '[data-slot="window-title-bar"]',
    )
    expect(strip).not.toBeNull()
    expect(strip!.parentElement?.firstElementChild).toBe(strip)
  })
})
