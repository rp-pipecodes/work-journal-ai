// @vitest-environment jsdom

import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { fakeDesktop, type FakeDesktop } from '@/platform/testing/desktop'
import ThemeProvider from '@/components/ThemeProvider'
import { createAppSettings } from '@/settings/app-settings'
import type { Journal, JournalExport } from '@/journal/journal'
import SettingsView from './SettingsView'

// Settings as the user meets it. The one seam that cannot be driven from Node:
// what a control reads, and what pressing it means, are decided in the view, so
// the view is where it has to be pressed.

afterEach(cleanup)

// jsdom has no media queries, and the Theme provider asks the OS which palette
// it prefers. A window that is never asked follows light, which is what an
// unasked user gets in the real app too.
beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia
})

/**
 * Settings over a fake desktop, inside the Theme provider the real app wraps
 * every window in — the Theme control reads and writes through it. Export is
 * the only thing here that reaches the journal, so tests that do not press it
 * hand over a promise that never settles.
 */
function showSettings(
  desktop: FakeDesktop,
  journal: Promise<Journal> = new Promise<Journal>(() => {}),
) {
  const settings = createAppSettings(desktop)
  render(
    <ThemeProvider settings={settings}>
      <SettingsView desktop={desktop} settings={settings} journal={journal} />
    </ThemeProvider>,
  )
}

/** A journal that exports whatever it is told to, and nothing else. */
function journalExporting(exported: JournalExport): Promise<Journal> {
  return Promise.resolve({
    exportJournal: async () => exported,
  } as unknown as Journal)
}

/** The Import switch, found the way the user finds it. */
function importSwitch(): HTMLElement {
  return screen.getByRole('switch', {
    name: "Add today's meetings to the journal",
  })
}

/** Whether a switch reads on, as the accessibility tree reports it. */
function isOn(control: HTMLElement): boolean {
  return control.getAttribute('aria-checked') === 'true'
}

describe('the Import switch', () => {
  it('withdraws the wish when pressed with the calendar permission gone', async () => {
    // The wish outlives a lost permission, which is what makes the reason
    // sayable — but it must not outlive the user changing their mind. The
    // switch already reads off, so pressing it can only mean "stop wishing".
    const desktop = fakeDesktop({
      stored: { importMeetings: true, startAtLogin: false },
      access: 'denied',
    })

    showSettings(desktop)

    // The mount effect has to have read the store and the access status.
    await screen.findByText(/calendar/i)
    expect(isOn(importSwitch())).toBe(false)

    importSwitch().click()

    await expect.poll(() => desktop.stored.importMeetings).toBe(false)
    expect(isOn(importSwitch())).toBe(false)
  })
})

describe('the Theme control', () => {
  it('offers the three Themes and records the one pressed', async () => {
    const desktop = fakeDesktop({ stored: { startAtLogin: false } })

    showSettings(desktop)

    for (const name of ['Light', 'Dark', 'System']) {
      expect(screen.getByRole('button', { name })).toBeTruthy()
    }
    expect(screen.queryByRole('combobox')).toBe(null)

    screen.getByRole('button', { name: 'Dark' }).click()

    await expect.poll(() => desktop.stored.theme).toBe('dark')
  })
})

describe('Start at login', () => {
  it('adds the app to the login items when switched on', async () => {
    const desktop = fakeDesktop({ stored: { startAtLogin: false } })

    showSettings(desktop)

    const control = await screen.findByRole('switch', {
      name: 'Start at login',
    })
    expect(isOn(control)).toBe(false)

    control.click()

    await expect.poll(() => desktop.loginItem).toBe(true)
    expect(desktop.stored.startAtLogin).toBe(true)
  })

  it('asks the first-run question once, and counts a closed window as no', async () => {
    // Never asked before: the store holds no answer at all.
    const desktop = fakeDesktop({ stored: {} })

    showSettings(desktop)

    await screen.findByText('Start Work Journal at login?')
    // The window is dismissed with the question still on screen.
    desktop.requestClose()

    await expect.poll(() => desktop.stored.startAtLogin).toBe(false)
  })
})

describe('the two Hotkeys', () => {
  it('renders one chip per key rather than a single string', async () => {
    const desktop = fakeDesktop({
      stored: { startAtLogin: false },
      hotkey: {
        note: { state: 'registered', hotkey: 'Cmd+Shift+J' },
        task: { state: 'registered', hotkey: 'Cmd+Shift+T' },
      },
    })

    showSettings(desktop)

    const chips = await screen.findByRole('group', {
      name: 'Current Note Hotkey',
    })
    expect(
      [...chips.querySelectorAll('kbd')].map((key) => key.textContent),
    ).toEqual(['Cmd', 'Shift', 'J'])
  })

  it('reports each Hotkey against its own action', async () => {
    const desktop = fakeDesktop({
      stored: { startAtLogin: false },
      hotkey: {
        note: { state: 'registered', hotkey: 'Cmd+Shift+J' },
        task: { state: 'unavailable', hotkey: 'Cmd+Shift+T', reason: 'taken' },
      },
    })

    showSettings(desktop)

    const problem = await screen.findByRole('alert')
    expect(problem.textContent).toContain('Task Hotkey')
    expect(problem.textContent).toContain('New Task')
    // The Note Hotkey is fine, and nothing on screen says otherwise.
    expect(screen.getAllByRole('alert')).toHaveLength(1)
  })

  it('remaps one Hotkey without touching the other', async () => {
    const desktop = fakeDesktop({ stored: { startAtLogin: false } })
    const asked: Array<[string, string]> = []
    desktop.setHotkey = async (action, hotkey) => {
      asked.push([action, hotkey])
      return {
        note: { state: 'registered', hotkey: 'Ctrl+Shift+Cmd+J' },
        task: { state: 'registered', hotkey },
      }
    }

    showSettings(desktop)

    const change = await screen.findByRole('button', {
      name: 'Change Task Hotkey',
    })
    change.click()

    const recorder = await screen.findByRole('button', {
      name: 'Press a combination…',
    })
    recorder.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'K',
        code: 'KeyK',
        ctrlKey: true,
        metaKey: true,
        bubbles: true,
      }),
    )

    await expect.poll(() => asked).toEqual([['task', 'Ctrl+Cmd+K']])
    const chips = await screen.findByRole('group', {
      name: 'Current Task Hotkey',
    })
    expect(
      [...chips.querySelectorAll('kbd')].map((key) => key.textContent),
    ).toEqual(['Ctrl', 'Cmd', 'K'])
  })

  it('says so when a remap is refused, and against the right action', async () => {
    const desktop = fakeDesktop({ stored: { startAtLogin: false } })
    desktop.setHotkey = () =>
      Promise.reject(new Error('it is already the Note Hotkey'))

    showSettings(desktop)

    const change = await screen.findByRole('button', {
      name: 'Change Task Hotkey',
    })
    change.click()

    const recorder = await screen.findByRole('button', {
      name: 'Press a combination…',
    })
    recorder.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'J',
        code: 'KeyJ',
        ctrlKey: true,
        shiftKey: true,
        metaKey: true,
        bubbles: true,
      }),
    )

    const problem = await screen.findByRole('alert')
    expect(problem.textContent).toContain('Task Hotkey')
    expect(problem.textContent).toContain('already the Note Hotkey')
  })
})

describe('Escape', () => {
  it('closes the window, unless the recorder is listening for a combination', async () => {
    const desktop = fakeDesktop({ stored: { startAtLogin: false } })
    let closed = 0
    desktop.closeWindow = async () => {
      closed += 1
    }

    showSettings(desktop)

    const change = await screen.findByRole('button', {
      name: 'Change Note Hotkey',
    })
    change.click()

    // The recorder owns Escape while it is listening: abandoning a
    // half-pressed combination must not take the window with it.
    const recorder = await screen.findByRole('button', {
      name: 'Press a combination…',
    })
    escape(recorder)
    expect(closed).toBe(0)

    // Abandoned, the window has Escape back.
    escape(await screen.findByRole('button', { name: 'Change Note Hotkey' }))
    expect(closed).toBe(1)
  })
})

describe('Export', () => {
  it('reports through a toast and leaves the last export announced', async () => {
    const desktop = fakeDesktop({ stored: { startAtLogin: false } })

    showSettings(
      desktop,
      journalExporting({ markdown: '- a note', noteCount: 1, taskCount: 0 }),
    )

    const button = await screen.findByRole('button', {
      name: 'Export all to Markdown',
    })
    button.click()

    // The toast says it once, in its own layer.
    await expect
      .poll(() => document.querySelector('[data-sonner-toaster]')?.textContent)
      .toMatch(/Exported 1 Note to/)

    // The line underneath keeps saying it, politely, for as long as the window
    // is open — a toast that has faded must not take the answer with it.
    // Found the way a screen reader finds it — the region itself carries no
    // name, so that what it says is what is announced.
    const announced = document.querySelector('p[role="status"]')
    expect(announced?.getAttribute('aria-live')).toBe('polite')
    expect(announced?.textContent).toMatch(/Exported 1 Note to/)
  })
})

describe('the window chrome', () => {
  it('keeps a strip above everything for the traffic lights to sit in', async () => {
    showSettings(fakeDesktop())
    await screen.findByText('Note Hotkey')

    const strip = titleBarStrip()
    // The window's own first row, and outside whatever scrolls: a strip that
    // scrolls away is a strip the traffic lights end up sitting on top of.
    expect(strip.parentElement?.firstElementChild).toBe(strip)
    expect(strip.parentElement?.className).not.toContain('overflow-y-auto')
  })
})

/** The room the overlay title bar's traffic lights are left. */
function titleBarStrip(): HTMLElement {
  const strip = document.querySelector<HTMLElement>(
    '[data-slot="window-title-bar"]',
  )
  if (strip === null) throw new Error('the window left no room for the chrome')
  return strip
}

/** Escape, pressed where the user's focus is. */
function escape(element: HTMLElement) {
  element.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
  )
}

describe('Task Alerts', () => {
  it('reports what macOS allows, asked afresh every time', async () => {
    showSettings(fakeDesktop({
      stored: { startAtLogin: false },
      alertPermission: 'granted',
    }))

    const row = await screen.findByText('Task Alerts')
    expect(row.closest('div')?.parentElement?.textContent).toContain('Allowed')
    expect(
      screen.queryByRole('button', { name: 'Open System Settings' }),
    ).toBeNull()
  })

  it('says the app has not asked yet, and why', async () => {
    showSettings(fakeDesktop({
      stored: { startAtLogin: false },
      alertPermission: 'undetermined',
    }))

    await screen.findByText('Task Alerts')
    expect(
      screen.getByText(/asks the first time you save a Task with a time/),
    ).toBeTruthy()
  })

  it('notices a permission restored in System Settings, and says so', async () => {
    const desktop = fakeDesktop({
      stored: { startAtLogin: false },
      alertPermission: 'denied',
    })
    let announced = 0
    void desktop.onTasksChanged(() => (announced += 1))
    showSettings(desktop)
    await screen.findByText('Task Alerts')

    // The user goes to System Settings, turns it on, and comes back.
    desktop.alertPermission = 'granted'
    desktop.focus()

    await expect.poll(() => screen.queryByText('Allowed')).not.toBeNull()
    // The Tasks still ahead have Alerts nobody has registered yet.
    expect(announced).toBe(1)
  })

  it('points a denial at System Settings rather than asking again', async () => {
    const desktop = fakeDesktop({
      stored: { startAtLogin: false },
      alertPermission: 'denied',
    })
    showSettings(desktop)

    await screen.findByText('Task Alerts')
    expect(
      screen.getByText(/System Settings › Notifications › Work Journal/),
    ).toBeTruthy()
    fireEvent.click(
      screen.getByRole('button', { name: 'Open System Settings' }),
    )

    await expect.poll(() => desktop.notificationSettingsOpened).toBe(1)
    // Never a second prompt: macOS answers for the user once it has an answer.
    expect(desktop.alertPrompted).toBe(false)
  })
})
