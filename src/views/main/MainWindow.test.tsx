// @vitest-environment jsdom

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fakeDesktop } from '@/platform/testing/desktop'
import type { MainSection } from '@/platform/desktop'
import type { Task } from '@/journal/journal'
import { formatDayRange } from '@/views/history/range-label'
import {
  closeTestDatabases,
  dayCell,
  firstListShown,
  installMeasurementStubs,
  journalHolding,
} from '@/views/history/testing/history-view'
import MainWindow from './MainWindow'

// The Main Window as the user meets it: a sidebar naming the section on
// screen, exactly one section showing, and each of them reading the journal
// exactly as it read it when it had a window of its own.

// Base UI positions its popups against measured elements, and jsdom measures
// nothing and ships neither observer.
beforeAll(installMeasurementStubs)

afterEach(() => {
  cleanup()
  closeTestDatabases()
  vi.restoreAllMocks()
})

describe('the Main Window', () => {
  it('opens on History, with the Notes already read back', async () => {
    await showMainWindow({ captured: [MONDAY] })

    expect(await screen.findByText('Monday')).toBeTruthy()
    // History's own header, untouched by the sidebar beside it.
    const header = screen.getByRole('banner')
    expect(within(header).getByLabelText('Search')).toBeTruthy()
    expect(within(header).getByRole('button', { name: /^Days/ })).toBeTruthy()
  })

  it('names the section on screen and marks it as the current one', async () => {
    await showMainWindow({ captured: [MONDAY] })

    const history = within(sidebar()).getByRole('button', { name: 'History' })
    expect(history.getAttribute('aria-current')).toBe('page')
  })

  it('puts every section a Tab away, as an ordinary button', async () => {
    await showMainWindow({ captured: [MONDAY] })

    for (const name of ['History', 'Tasks']) {
      const section = within(sidebar()).getByRole('button', { name })
      // Nothing takes the section out of the tab order or rebinds a key to
      // reach it: the sidebar is a short list of named places.
      expect(section.tabIndex).toBe(0)
      expect(section.getAttribute('disabled')).toBeNull()
    }
  })

  it('leaves the traffic lights the sidebar’s top row', async () => {
    await showMainWindow({ captured: [MONDAY] })

    // The title bar is an overlay drawn over the window's top-left corner,
    // which is over the sidebar rather than over the section.
    expect(sidebar().firstElementChild?.getAttribute('data-slot')).toBe(
      'window-title-bar',
    )
  })
})

describe('the section the Main Window opens on', () => {
  it('is the one the Entry Point that opened it named', async () => {
    await showMainWindow({ captured: [MONDAY], section: 'tasks', tasks: ['renew the cert'] })

    await showsTasks()
  })

  it('is History when the Entry Point named none', async () => {
    await showMainWindow({ captured: [MONDAY], tasks: ['renew the cert'] })

    await showsHistory()
  })
})

describe('switching sections', () => {
  it('shows the one the sidebar names, and only that one', async () => {
    const user = userEvent.setup()
    await showMainWindow({ captured: [MONDAY], tasks: ['renew the cert'] })

    await user.click(within(sidebar()).getByRole('button', { name: 'Tasks' }))

    await showsTasks()
    expect(
      within(sidebar()).getByRole('button', { name: 'Tasks' }).getAttribute('aria-current'),
    ).toBe('page')
  })

  it('follows an Entry Point that names a section while the window is open', async () => {
    const { desktop } = await showMainWindow({
      captured: [MONDAY],
      tasks: ['renew the cert'],
    })

    // The Tray Menu's "View Tasks", reaching a window already on History.
    desktop.requestSection('tasks')
    await showsTasks()

    // And "View Notes", reaching the same window on Tasks View.
    desktop.requestSection('history')
    await showsHistory()
  })

  it('leaves the Filter exactly as it was through a round trip', async () => {
    const user = userEvent.setup()
    await showMainWindow({
      captured: [MONDAY, { at: '2026-03-11T10:00:00', body: 'Wednesday' }],
      tasks: ['renew the cert'],
    })

    await user.click(days())
    await user.click(await dayCell('2026-03-09'))
    await user.click(await dayCell('2026-03-11'))
    const narrowed = days().textContent
    expect(narrowed).toContain(formatDayRange('2026-03-09', '2026-03-11'))

    await user.click(within(sidebar()).getByRole('button', { name: 'Tasks' }))
    await showsTasks()
    await user.click(within(sidebar()).getByRole('button', { name: 'History' }))
    await showsHistory()

    // The reader comes back to the days they left, not to the days History
    // opens on: the section was hidden, never torn down.
    expect(days().textContent).toBe(narrowed)
    expect(screen.getByText('Monday')).toBeTruthy()
  })

  it('leaves a Nudge waiting on History, with nothing on the sidebar', async () => {
    const user = userEvent.setup()
    const { desktop } = await showMainWindow({
      captured: [MONDAY],
      tasks: ['renew the cert'],
    })
    await user.click(within(sidebar()).getByRole('button', { name: 'Tasks' }))
    await showsTasks()

    await desktop.announceCapturedNote('2026-03-12')

    // Nothing on screen says so while Tasks View is showing: the sidebar is a
    // list of places, not a set of counters.
    expect(nudge()).toBeUndefined()
    expect(sidebar().textContent).toBe('HistoryTasks')

    await user.click(within(sidebar()).getByRole('button', { name: 'History' }))
    await expect.poll(() => nudge()?.textContent).toContain('A new Note on')
  })
})

describe('Escape', () => {
  it('reaches the section the Entry Point opened the window on', async () => {
    const { desktop } = await showMainWindow({
      captured: [MONDAY],
      tasks: ['renew the cert'],
      section: 'tasks',
    })
    await showsTasks()

    await userEvent.setup().keyboard('{Escape}')

    // Escape is the section's, bound to its own root: a window opened on Tasks
    // View closes from Tasks View.
    await expect.poll(() => desktop.windowsClosed).toBe(1)
  })

  it('reaches the section the sidebar switched to', async () => {
    const user = userEvent.setup()
    const { desktop } = await showMainWindow({
      captured: [MONDAY],
      tasks: ['renew the cert'],
    })

    await user.click(within(sidebar()).getByRole('button', { name: 'Tasks' }))
    await showsTasks()
    await user.keyboard('{Escape}')

    // The click left the focus on the sidebar button, which is in neither
    // section — so the section switched to is handed it.
    await expect.poll(() => desktop.windowsClosed).toBe(1)
  })
})

describe('a clicked Task Alert', () => {
  it('opens the window on Tasks View, focused on that Task', async () => {
    const { created } = await showMainWindow({
      captured: [MONDAY],
      tasks: ['renew the cert'],
      // Both, as the Rust side leaves them for a window the click builds: the
      // section is the window's to switch to, the Task is Tasks View's to
      // single out.
      section: 'tasks',
      alertFor: 0,
    })

    await showsTasks()
    await singlesOut(created[0])
  })

  it('switches a window already on History, and focuses the Task', async () => {
    const { desktop, created } = await showMainWindow({
      captured: [MONDAY],
      tasks: ['renew the cert'],
    })
    await showsHistory()

    desktop.requestSection('tasks')
    desktop.openTaskAlert(`task:${created[0].id}`)

    await showsTasks()
    await singlesOut(created[0])
  })
})

const MONDAY = { at: '2026-03-09T10:00:00', body: 'Monday' }

/** The Main Window over a real journal, already showing its first list. */
async function showMainWindow({
  captured,
  tasks = [],
  section,
  alertFor,
}: {
  captured: Array<{ at: string; body: string }>
  /** The Tasks the journal already holds, in the order they were created. */
  tasks?: string[]
  /** The section the Entry Point that opened the window named, if it named one. */
  section?: MainSection
  /** The Task a clicked Alert was about, as its position in `tasks`. */
  alertFor?: number
}) {
  const { driver, core, clock } = await journalHolding(captured)

  const created: Task[] = []
  for (const description of tasks) {
    created.push(await core.createTask(description))
  }

  const desktop = fakeDesktop({ driver })
  if (section !== undefined) desktop.requestSection(section)
  if (alertFor !== undefined) {
    desktop.pendingTaskAlert = `task:${created[alertFor].id}`
  }

  render(
    <MainWindow
      desktop={desktop}
      journal={Promise.resolve(core)}
      clock={clock}
    />,
  )
  await firstListShown(captured.length)

  return { desktop, core, created }
}

/** The sidebar, as the only thing on screen that lists the sections. */
function sidebar(): HTMLElement {
  return screen.getByRole('navigation', { name: 'Sections' })
}

/** History's days control — on screen only while History is the section. */
function days(): HTMLElement {
  return within(screen.getByRole('banner')).getByRole('button', {
    name: /^Days/,
  })
}

/** The Nudge, if History is showing one; undefined when nothing is waiting. */
function nudge(): HTMLElement | undefined {
  return screen
    .queryAllByRole('status')
    .find((element) => element.textContent?.includes('A new Note on'))
}

/** Tasks View is the section on screen, once whatever asked for it lands. */
async function showsTasks(): Promise<void> {
  await expect.poll(sectionOnScreen).toBe('tasks')
}

/** History is the section on screen. */
async function showsHistory(): Promise<void> {
  await expect.poll(sectionOnScreen).toBe('history')
}

/**
 * Which section is on screen, read the way a screen reader would: the section
 * that is not showing is hidden rather than unmounted, so exactly one of the
 * two headers is in the accessibility tree — and asking for the banner at all
 * fails if that is ever untrue.
 */
function sectionOnScreen(): 'history' | 'tasks' {
  const header = screen.getByRole('banner')
  return within(header).queryByLabelText('Search') === null
    ? 'tasks'
    : 'history'
}

/** The row for one Task, as the click on its Alert leaves it. */
async function singlesOut(task: Task): Promise<void> {
  await expect
    .poll(() =>
      screen
        .queryByText(task.description)
        ?.closest('li')
        ?.getAttribute('aria-current'),
    )
    .toBe('true')
}
