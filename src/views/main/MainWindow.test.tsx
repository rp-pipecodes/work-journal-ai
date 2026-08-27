// @vitest-environment jsdom

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ThemeProvider from '@/components/ThemeProvider'
import { fakeDesktop, type FakeDesktop } from '@/platform/testing/desktop'
import type { MainSection } from '@/platform/desktop'
import type { Task } from '@/journal/journal'
import { formatDayRange } from '@/views/history/range-label'
import { createAppSettings } from '@/settings/app-settings'
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
    expect(
      within(sidebar())
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['History', 'Tasks', 'Settings'])
  })

  it('puts every section a Tab away, as an ordinary button', async () => {
    await showMainWindow({ captured: [MONDAY] })

    for (const name of ['History', 'Tasks', 'Settings']) {
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

  it('lands on Settings when the Entry Point names it', async () => {
    await showMainWindow({ captured: [MONDAY], section: 'settings' })

    await showsSettings()
    expect(
      within(sidebar()).getByRole('button', { name: 'Settings' }).getAttribute('aria-current'),
    ).toBe('page')
  })

  it('is History when the Entry Point named none', async () => {
    await showMainWindow({ captured: [MONDAY], tasks: ['renew the cert'] })

    await showsHistory()
  })

  it('is the one named while the window was still starting up', async () => {
    await showMainWindow({
      captured: [MONDAY],
      tasks: ['renew the cert'],
      // The Tray Menu reached before the webview has come up: nothing is
      // listening yet, so the window has to find the section as it asks.
      whileStartingUp: (desktop) => desktop.requestSection('tasks'),
    })

    await showsTasks()
  })

  it('is the one named last when two requests arrive back to back', async () => {
    await showMainWindow({
      captured: [MONDAY],
      tasks: ['renew the cert'],
      // A clicked Task Alert builds the window, and the Tray Menu is reached
      // before it is on screen. The window lands where the user last asked.
      section: 'tasks',
      whileStartingUp: (desktop) => desktop.requestSection('settings'),
    })

    await showsSettings()
  })

  it('is History for a Dock click, whatever an earlier request named', async () => {
    const { desktop } = await showMainWindow({
      captured: [MONDAY],
      tasks: ['renew the cert'],
      section: 'tasks',
      // A click on the Dock icon names no section, and the window it opens
      // does not inherit the section left over from the Tray Menu.
      whileStartingUp: (desktop) => desktop.requestSection(null),
    })

    // History is where the window starts, so the claim has to have come back
    // before this says anything: it came back with nothing.
    await expect.poll(() => desktop.sectionsClaimed).toBe(1)
    await showsHistory()
  })

  it('does not show Settings’ first-run question while History is selected', async () => {
    await showMainWindow({ captured: [MONDAY], stored: {} })

    // Wait for Settings' asynchronous initial read to finish. Its footer is
    // hidden while History is selected, but it is still the real SettingsView
    // mounted by this integration seam.
    await screen.findByText('test')
    expect(screen.queryByRole('alertdialog')).toBeNull()
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

  it('shows Settings when the sidebar names it', async () => {
    const user = userEvent.setup()
    await showMainWindow({ captured: [MONDAY] })

    await user.click(within(sidebar()).getByRole('button', { name: 'Settings' }))

    await showsSettings()
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
    expect(sidebar().textContent).toBe('HistoryTasksSettings')

    await user.click(within(sidebar()).getByRole('button', { name: 'History' }))
    await expect.poll(() => nudge()?.textContent).toContain('A new Note on')
  })
})

describe('a section that is not showing', () => {
  it('takes an open confirmation off the screen when an Entry Point switches', async () => {
    const user = userEvent.setup()
    const { desktop } = await showMainWindow({
      captured: [MONDAY],
      tasks: ['renew the cert'],
      section: 'tasks',
    })
    await showsTasks()

    await user.click(
      await screen.findByRole('button', { name: 'Delete \u201Crenew the cert\u201D' }),
    )
    expect(await screen.findByRole('alertdialog')).toBeTruthy()

    // A clicked Task Alert, or the Tray Menu, while the confirmation is up.
    desktop.requestSection('history')
    await showsHistory()

    // The confirmation belonged to a section nobody can see: it is portalled
    // out of the wrapper that hides it, so it has to go rather than hide.
    await expect.poll(() => screen.queryByRole('alertdialog')).toBeNull()
    // And History answers: nothing modal is standing over it.
    await user.click(days())
    expect(await dayCell('2026-03-09')).toBeTruthy()
  })

  it('does not resurrect the confirmation on the way back', async () => {
    const user = userEvent.setup()
    const { desktop } = await showMainWindow({
      captured: [MONDAY],
      tasks: ['renew the cert'],
      section: 'tasks',
    })
    await showsTasks()
    await user.click(
      await screen.findByRole('button', { name: 'Delete \u201Crenew the cert\u201D' }),
    )
    await screen.findByRole('alertdialog')

    desktop.requestSection('history')
    await showsHistory()
    await user.click(within(sidebar()).getByRole('button', { name: 'Tasks' }))
    await showsTasks()

    // Switching away dismissed it. Coming back is not asking again.
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.getByText('renew the cert')).toBeTruthy()
  })

  it('takes the Editor\u2019s own question with it, and leaves the Editor', async () => {
    const { core, created, desktop } = await showMainWindow({
      captured: [MONDAY],
      tasks: ['water the plants'],
      section: 'tasks',
    })
    await showsTasks()
    await core.editTask(created[0].id, {
      description: 'water the plants',
      schedule: { date: '2026-03-16', time: null },
      recurrence: { unit: 'day', interval: 1, weekdays: [] },
    })
    await desktop.announceTasksChanged()

    // The cadence on screen, so the row clicked below is the re-read one.
    await screen.findByText('every day')

    fireEvent.click(screen.getByText('water the plants'))
    await screen.findByRole('dialog', { name: 'Edit Task' })
    fireEvent.click(screen.getByRole('button', { name: 'Clear the schedule' }))
    expect(await screen.findByRole('alertdialog')).toBeTruthy()

    desktop.requestSection('history')
    await showsHistory()
    await expect.poll(() => screen.queryByRole('alertdialog')).toBeNull()

    desktop.requestSection('tasks')
    await showsTasks()

    // The question is gone and nothing was answered on the user's behalf: the
    // Task still repeats, and the Editor is where they left it.
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Edit Task' })).toBeTruthy()
    expect((screen.getByLabelText('Repeats') as HTMLSelectElement).value).toBe(
      'day',
    )
  })

  it('takes History\u2019s own confirmation with it', async () => {
    const user = userEvent.setup()
    const { desktop } = await showMainWindow({
      captured: [MONDAY],
      tasks: ['renew the cert'],
    })

    await user.click(
      await screen.findByRole('button', { name: 'Delete \u201CMonday\u201D' }),
    )
    expect(await screen.findByRole('alertdialog')).toBeTruthy()

    desktop.requestSection('tasks')
    await showsTasks()

    // Every section owns what it put on screen, not only Tasks View.
    await expect.poll(() => screen.queryByRole('alertdialog')).toBeNull()
    desktop.requestSection('history')
    await showsHistory()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    // Dismissed, never confirmed: the Note is still there.
    expect(screen.getByText('Monday')).toBeTruthy()
  })

  it('takes an open picker with it, and leaves the Filter alone', async () => {
    const user = userEvent.setup()
    const { desktop } = await showMainWindow({
      captured: [MONDAY],
      tasks: ['renew the cert'],
    })
    const before = days().textContent

    await user.click(days())
    expect(await dayCell('2026-03-09')).toBeTruthy()

    // The Tray Menu, rather than a click on the sidebar: an outside click
    // would have closed the popup on its own, and the Entry Point is the path
    // that reaches the window with nothing dismissed.
    desktop.requestSection('tasks')
    await showsTasks()

    // The calendar is portalled to the end of the document, so hiding History
    // does not reach it.
    await expect.poll(() => document.querySelector('[data-day]')).toBeNull()

    desktop.requestSection('history')
    await showsHistory()
    // Closing a picker picks nothing: the days are the days the reader left.
    expect(days().textContent).toBe(before)
  })
})

describe('the first-run question', () => {
  it('is off the screen while another section is showing, and back on returning', async () => {
    const user = userEvent.setup()
    const { desktop } = await showMainWindow({
      captured: [MONDAY],
      section: 'settings',
      stored: {},
    })
    expect(await screen.findByRole('alertdialog')).toBeTruthy()

    // The Tray Menu's "View Notes", which reaches the window whatever is on
    // screen — the question is modal, and the sidebar is behind it.
    desktop.requestSection('history')
    await showsHistory()
    await expect.poll(() => screen.queryByRole('alertdialog')).toBeNull()

    // And Tasks View, which is no more the place to answer it than History is.
    await user.click(within(sidebar()).getByRole('button', { name: 'Tasks' }))
    await showsTasks()
    expect(screen.queryByRole('alertdialog')).toBeNull()

    await user.click(within(sidebar()).getByRole('button', { name: 'Settings' }))
    await showsSettings()

    // Unanswered is unanswered: the question is still the one thing the app is
    // waiting on, and Settings is where it is asked.
    expect(await screen.findByRole('alertdialog')).toBeTruthy()
  })

  it('records Not now when the window closes after a visit to another section', async () => {
    const { desktop } = await showMainWindow({
      captured: [MONDAY],
      section: 'settings',
      stored: {},
    })
    await screen.findByRole('alertdialog')

    desktop.requestSection('history')
    await showsHistory()
    desktop.requestClose()

    // Closing without answering is an answer, wherever the window was left.
    await expect.poll(() => desktop.stored.startAtLogin).toBe(false)
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
  whileStartingUp,
  alertFor,
  stored = { startAtLogin: false },
}: {
  captured: Array<{ at: string; body: string }>
  /** The Tasks the journal already holds, in the order they were created. */
  tasks?: string[]
  /** The section the Entry Point that opened the window named, if it named one. */
  section?: MainSection
  /**
   * An Entry Point reached in the moment between the window being built and
   * its webview coming up — the window exists, and nothing in it is listening.
   */
  whileStartingUp?: (desktop: FakeDesktop) => void
  /** The Task a clicked Alert was about, as its position in `tasks`. */
  alertFor?: number
  /** Values in the settings store; empty means the first-run question is due. */
  stored?: Record<string, unknown>
}) {
  const { driver, core, clock } = await journalHolding(captured)

  const created: Task[] = []
  for (const description of tasks) {
    created.push(await core.createTask(description))
  }

  const desktop = fakeDesktop({ driver, stored })
  const settings = createAppSettings(desktop)
  if (section !== undefined) desktop.requestSection(section)
  if (alertFor !== undefined) {
    desktop.pendingTaskAlert = `task:${created[alertFor].id}`
  }

  render(
    <ThemeProvider settings={settings}>
      <MainWindow
        desktop={desktop}
        settings={settings}
        journal={Promise.resolve(core)}
        clock={clock}
      />
    </ThemeProvider>,
  )
  whileStartingUp?.(desktop)
  // Where a window still starting up lands is what those tests are about, so
  // they wait for the section themselves rather than for one of them here.
  if (whileStartingUp !== undefined) {
    await screen.findByRole('navigation', { name: 'Sections' })
  } else if (section === 'settings') {
    await screen.findByText('Note Hotkey')
  } else {
    await firstListShown(captured.length)
  }

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

/** Settings is the section on screen, once whatever asked for it lands. */
async function showsSettings(): Promise<void> {
  await screen.findByText('Note Hotkey')
  await expect.poll(sectionOnScreen).toBe('settings')
}

/**
 * Which section is on screen, read the way a screen reader would: the section
 * that is not showing is hidden rather than unmounted, so exactly one of the
 * two headers is in the accessibility tree — and asking for the banner at all
 * fails if that is ever untrue.
 */
function sectionOnScreen(): MainSection {
  const header = screen.queryByRole('banner')
  if (header === null) return 'settings'

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
