// @vitest-environment jsdom

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  deferredStore,
  fakeDesktop,
  type FakeDesktop,
} from '@/platform/testing/desktop'
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

  it('survives a press made before the settings file opens', async () => {
    // The settings file opens while this window is already on screen, and the
    // switch is writable in that gap. A press made there is already in the
    // file by the time the read lands; seeding the switch would flip it back
    // to the value read before the press, leaving the switch and the file
    // disagreeing with nothing to say so.
    const stored: Record<string, unknown> = {
      importMeetings: false,
      startAtLogin: false,
      model: 'gpt-stored',
    }
    const deferred = deferredStore(stored)
    const desktop = fakeDesktop({
      stored,
      access: 'granted',
      openSettingsStore: deferred.openSettingsStore,
    })

    showSettings(desktop)

    expect(isOn(importSwitch())).toBe(false)
    importSwitch().click()

    deferred.openTheStore()
    await readLanded()

    // The press survives, and the switch agrees with the file afterwards.
    expect(isOn(importSwitch())).toBe(true)
    await expect.poll(() => desktop.stored.importMeetings).toBe(true)
  })

  it('keeps a calendar tick made before the settings file opens', async () => {
    // Turning Import on is where the calendars are shown, and both can happen
    // while the settings file is still opening: the tick is already in the
    // file by the time the read lands, and seeding the ticks would untick it.
    const stored: Record<string, unknown> = {
      importMeetings: true,
      importCalendars: [],
      startAtLogin: false,
      model: 'gpt-stored',
    }
    const deferred = deferredStore(stored)
    const desktop = fakeDesktop({
      stored,
      access: 'granted',
      calendars: [{ id: 'work', title: 'Work', source: 'iCloud' }],
      openSettingsStore: deferred.openSettingsStore,
    })

    showSettings(desktop)

    // The switch reads off until the read lands, so the user turns Import on
    // and ticks a calendar while the file is still opening.
    expect(isOn(importSwitch())).toBe(false)
    importSwitch().click()
    const work = await screen.findByRole('checkbox', { name: /Work/ })
    work.click()

    deferred.openTheStore()
    await readLanded()

    // The tick survives, and the file agrees.
    expect(isOn(screen.getByRole('checkbox', { name: /Work/ }))).toBe(true)
    await expect.poll(() => desktop.stored.importCalendars).toEqual(['work'])
  })

  it('rolls a failed switch save back to what the file holds', async () => {
    // The wish is written to the file before the announcement is sent, so a
    // refusal arrives after the change took. The rollback re-reads what the
    // file holds now — the wish, newer than the initial snapshot, so it
    // wins over the arriving read — and the switch agrees with the file.
    const stored: Record<string, unknown> = {
      importMeetings: true,
      startAtLogin: false,
      model: 'gpt-stored',
    }
    const deferred = deferredStore(stored)
    const desktop = fakeDesktop({
      stored,
      access: 'granted',
      openSettingsStore: deferred.openSettingsStore,
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    desktop.announceImportChanged = () =>
      Promise.reject(new Error('the window is gone'))

    showSettings(desktop)

    expect(isOn(importSwitch())).toBe(false)
    importSwitch().click()

    deferred.openTheStore()
    await readLanded()

    // The write reached the file; the switch reads the same wish, not the
    // default the failed press rolled back to.
    expect(isOn(importSwitch())).toBe(true)
    await expect.poll(() => desktop.stored.importMeetings).toBe(true)
  })

  it('keeps a calendar tick after its save failed', async () => {
    // The tick is written to the file before the announcement is sent, so a
    // refusal arrives after the tick took. The rollback re-reads what the
    // file holds now — the tick, newer than the initial snapshot, so it
    // wins over the arriving read — and the tick agrees with the file.
    const stored: Record<string, unknown> = {
      importMeetings: true,
      importCalendars: ['work'],
      startAtLogin: false,
      model: 'gpt-stored',
    }
    const deferred = deferredStore(stored)
    const desktop = fakeDesktop({
      stored,
      access: 'granted',
      calendars: [{ id: 'work', title: 'Work', source: 'iCloud' }],
      openSettingsStore: deferred.openSettingsStore,
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    // The switch's own announcement lands; the tick's does not.
    let announcements = 0
    desktop.announceImportChanged = () => {
      announcements += 1
      return announcements === 1
        ? Promise.resolve()
        : Promise.reject(new Error('the window is gone'))
    }

    showSettings(desktop)

    expect(isOn(importSwitch())).toBe(false)
    importSwitch().click()
    const work = await screen.findByRole('checkbox', { name: /Work/ })
    work.click()

    deferred.openTheStore()
    await readLanded()

    // The write reached the file; the tick reads the same choice, not the
    // blank the failed save rolled it back to.
    expect(isOn(screen.getByRole('checkbox', { name: /Work/ }))).toBe(true)
    await expect.poll(() => desktop.stored.importCalendars).toEqual(['work'])
  })

  it('keeps a grant won in the gap over the older read', async () => {
    // The read's calendar access is answered while the window is still
    // opening — before the toggle asked macOS and was granted. The arriving
    // snapshot is therefore older than the permission the toggle just won,
    // and must not take it away: the switch reads the granted state the
    // toggle produced, and the calendars it fetched over the answer stay.
    const stored: Record<string, unknown> = {
      importMeetings: true,
      startAtLogin: false,
      model: 'gpt-stored',
    }
    const deferred = deferredStore(stored)
    const desktop = fakeDesktop({
      stored,
      // Not asked yet when the read is taken; the toggle asks in the gap and
      // macOS grants.
      access: 'undetermined',
      calendars: [{ id: 'work', title: 'Work', source: 'iCloud' }],
      openSettingsStore: deferred.openSettingsStore,
    })

    showSettings(desktop)

    // The switch reads off at its default while the file is still opening,
    // so the user turns Import on; macOS answers the grant.
    expect(isOn(importSwitch())).toBe(false)
    importSwitch().click()
    await screen.findByRole('checkbox', { name: /Work/ })
    expect(desktop.access).toBe('granted')

    deferred.openTheStore()
    await readLanded()

    // The stale snapshot said "not asked"; the toggle's grant is newer, so
    // the switch stays on, the calendars it fetched stay, and no reason is
    // offered for a permission that was just granted.
    expect(isOn(importSwitch())).toBe(true)
    expect(screen.getByRole('checkbox', { name: /Work/ })).toBeTruthy()
    expect(
      screen.queryByText(/has not been asked about your calendars/),
    ).toBeNull()
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

  it('keeps the window open when Escape belongs to the first-run question', async () => {
    const desktop = fakeDesktop({ stored: {} })
    let closed = 0
    desktop.closeWindow = async () => {
      closed += 1
    }

    showSettings(desktop)

    const question = await screen.findByRole('alertdialog')
    escape(question)

    expect(closed).toBe(0)
    expect(screen.getByRole('alertdialog')).toBeTruthy()
  })

  it('keeps the Theme Toggle available while the first-run question is open', async () => {
    const desktop = fakeDesktop({ stored: {} })

    showSettings(desktop)

    const question = await screen.findByRole('alertdialog')
    question.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'd',
        metaKey: true,
        shiftKey: true,
        bubbles: true,
      }),
    )

    await expect.poll(() => desktop.stored.theme).toBe('dark')
  })

  it('opens on the stored start-at-login choice', async () => {
    const desktop = fakeDesktop({ stored: { startAtLogin: true } })
    // The switch is seeded from the login item the OS reports, which an
    // earlier run left there.
    desktop.loginItem = true

    showSettings(desktop)

    const control = await screen.findByRole('switch', {
      name: 'Start at login',
    })
    await expect.poll(() => isOn(control)).toBe(true)
  })

  it('keeps a switch change made before the settings file opens', async () => {
    // The switch is writable before the settings file opens, and a change made
    // there is already in the file by the time the read lands; seeding the
    // switch would flip it back to the value read before the change.
    const stored: Record<string, unknown> = {
      startAtLogin: false,
      model: 'gpt-stored',
    }
    const deferred = deferredStore(stored)
    const desktop = fakeDesktop({
      stored,
      openSettingsStore: deferred.openSettingsStore,
    })

    showSettings(desktop)

    const control = await screen.findByRole('switch', {
      name: 'Start at login',
    })
    expect(isOn(control)).toBe(false)
    control.click()

    deferred.openTheStore()
    await readLanded()

    expect(
      isOn(screen.getByRole('switch', { name: 'Start at login' })),
    ).toBe(true)
    await expect.poll(() => desktop.stored.startAtLogin).toBe(true)
  })

  it('does not ask the first-run question after the switch was already answered', async () => {
    // Never asked before, and answered by hand while the file is still
    // opening: the arriving read must not follow that answer with the
    // question.
    const stored: Record<string, unknown> = {
      model: 'gpt-stored',
    }
    const deferred = deferredStore(stored)
    const desktop = fakeDesktop({
      stored,
      openSettingsStore: deferred.openSettingsStore,
    })

    showSettings(desktop)

    const control = await screen.findByRole('switch', {
      name: 'Start at login',
    })
    control.click()

    deferred.openTheStore()
    await readLanded()

    // The switch was the answer; the question must not follow it.
    expect(screen.queryByRole('alertdialog')).toBeNull()
    await expect.poll(() => desktop.stored.startAtLogin).toBe(true)
  })

  it('rolls a failed switch save back to what the OS still says', async () => {
    // The login item is changed before the file is written, so a refusal
    // leaves both holding the earlier wish. The rollback re-reads what the
    // OS says now — newer than the initial snapshot, so it wins over the
    // arriving read — and the switch agrees with the OS and the file.
    const stored: Record<string, unknown> = {
      startAtLogin: true,
      model: 'gpt-stored',
    }
    const deferred = deferredStore(stored)
    const desktop = fakeDesktop({
      stored,
      openSettingsStore: deferred.openSettingsStore,
    })
    // An earlier run left the login item there.
    desktop.loginItem = true
    vi.spyOn(console, 'error').mockImplementation(() => {})
    desktop.setStartAtLogin = () =>
      Promise.reject(new Error('macOS refused'))

    showSettings(desktop)

    const control = await screen.findByRole('switch', {
      name: 'Start at login',
    })
    // The switch reads off at its default while the file is still opening.
    expect(isOn(control)).toBe(false)
    control.click()

    deferred.openTheStore()
    await readLanded()

    // The rollback re-read the OS and won over the arriving read: the
    // switch agrees with the OS and the file.
    expect(
      isOn(screen.getByRole('switch', { name: 'Start at login' })),
    ).toBe(true)
    expect(desktop.stored.startAtLogin).toBe(true)
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

    await screen.findByRole('group', { name: 'Current Note Hotkey' })
    expect(chips('Current Note Hotkey')).toEqual(['Cmd', 'Shift', 'J'])
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
    await screen.findByRole('group', { name: 'Current Task Hotkey' })
    expect(chips('Current Task Hotkey')).toEqual(['Ctrl', 'Cmd', 'K'])
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

  it('keeps a remap completed before the settings file opens', async () => {
    // The read's pair is captured while the file is still opening, so a remap
    // completed in that gap is newer than it; seeding the pair would put the
    // stale combination back over the completed one.
    const stored: Record<string, unknown> = {
      startAtLogin: false,
      model: 'gpt-stored',
    }
    const deferred = deferredStore(stored)
    const desktop = fakeDesktop({
      stored,
      openSettingsStore: deferred.openSettingsStore,
    })

    showSettings(desktop)

    const change = await screen.findByRole('button', {
      name: 'Change Note Hotkey',
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

    // The remap is complete before the read lands.
    await expect.poll(() => chips('Current Note Hotkey')).toEqual([
      'Ctrl',
      'Cmd',
      'K',
    ])

    deferred.openTheStore()
    await readLanded()

    expect(chips('Current Note Hotkey')).toEqual(['Ctrl', 'Cmd', 'K'])
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

/** The chips a Hotkey reads as, left to right. */
function chips(name: string): Array<string | null> {
  return [...screen.getByRole('group', { name }).querySelectorAll('kbd')].map(
    (key) => key.textContent,
  )
}

/**
 * The settings read has landed: the Model field — seeded by the very same
 * read every settings group shares — now holds the stored value. Waited on
 * rather than on a clock, so a test that acted in the gap knows exactly when
 * the arriving read has had its say.
 *
 * Two couplings ride along, both silent if they break:
 *
 * - It stands for "every group has seeded" only because Model Access is the
 *   last group that seeds from the initial read in SettingsView.tsx: the
 *   seed callbacks on the shared promise run in mount order, so by the time
 *   the Model field has been set and rendered, every earlier group's seed
 *   has run in the same pass. Reordering the groups (or adding a seeding
 *   group after Model Access) makes this barrier assert too early, silently.
 * - It waits on the Model field holding the stored value, so every race
 *   test's store must hold `model: 'gpt-stored'` (or the value passed here).
 */
async function readLanded(model = 'gpt-stored'): Promise<void> {
  await expect
    .poll(() => (screen.getByLabelText('Model') as HTMLInputElement).value)
    .toBe(model)
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

describe('Model Access', () => {
  it('remembers the Base URL and the Model as they are typed', async () => {
    const desktop = fakeDesktop({ stored: { startAtLogin: false } })

    showSettings(desktop)

    const baseUrl = await screen.findByLabelText('Base URL')
    // OpenAI's until the user points it somewhere else.
    expect((baseUrl as HTMLInputElement).value).toBe('https://api.openai.com/v1')

    fireEvent.change(baseUrl, { target: { value: 'http://localhost:11434/v1' } })
    fireEvent.change(screen.getByLabelText('Model'), {
      target: { value: 'llama3.1' },
    })

    await expect
      .poll(() => desktop.stored.modelBaseUrl)
      .toBe('http://localhost:11434/v1')
    expect(desktop.stored.model).toBe('llama3.1')
  })

  it('opens on what an earlier run stored', async () => {
    const desktop = fakeDesktop({
      stored: {
        startAtLogin: false,
        modelBaseUrl: 'https://example.test/v1',
        model: 'gpt-test',
      },
    })

    showSettings(desktop)

    const baseUrl = (await screen.findByLabelText(
      'Base URL',
    )) as HTMLInputElement
    await expect.poll(() => baseUrl.value).toBe('https://example.test/v1')
    expect((screen.getByLabelText('Model') as HTMLInputElement).value).toBe(
      'gpt-test',
    )
  })

  it('puts the API Key in the Keychain and never in the settings file', async () => {
    const desktop = fakeDesktop({ stored: { startAtLogin: false } })

    showSettings(desktop)

    await screen.findByText(/No key is saved/)
    fireEvent.change(screen.getByLabelText('API Key'), {
      target: { value: 'sk-a-real-key' },
    })
    screen.getByRole('button', { name: 'Save' }).click()

    await expect.poll(() => desktop.apiKey).toBe('sk-a-real-key')
    // Nothing in the store is the key, under any name.
    expect(Object.values(desktop.stored)).not.toContain('sk-a-real-key')
    await screen.findByText(/A key is saved/)
    // And the window keeps no copy of it either.
    expect((screen.getByLabelText('API Key') as HTMLInputElement).value).toBe('')
  })

  it('says whether a key is set rather than what it is', async () => {
    const desktop = fakeDesktop({
      stored: { startAtLogin: false },
      apiKey: 'sk-from-an-earlier-run',
    })

    showSettings(desktop)

    await screen.findByText(/A key is saved/)
    expect((screen.getByLabelText('API Key') as HTMLInputElement).value).toBe('')
    expect(document.body.textContent).not.toContain('sk-from-an-earlier-run')
  })

  it('takes the key out of the Keychain when it is cleared', async () => {
    const desktop = fakeDesktop({
      stored: { startAtLogin: false },
      apiKey: 'sk-from-an-earlier-run',
    })

    showSettings(desktop)

    const clear = await screen.findByRole('button', { name: 'Clear' })
    clear.click()

    // A Keychain entry outlives an uninstall, so this is the only way out.
    await expect.poll(() => desktop.apiKey).toBe(null)
    await screen.findByText(/No key is saved/)
  })

  it('says why a refusing Keychain is refusing, and leaves the rest working', async () => {
    const desktop = fakeDesktop({
      stored: { startAtLogin: false },
      keychainRefuses: true,
    })

    showSettings(desktop)

    // In the Keychain's own words, so a locked one and a denied prompt do not
    // read the same.
    await screen.findByText(/the keychain could not be reached/)
    // And nothing claims to know whether a key is saved while it will not say.
    expect(screen.queryByRole('button', { name: 'Clear' })).toBe(null)
    expect(document.body.textContent).not.toContain('A key is saved')
    // Every other setting still answers for itself.
    const startAtLogin = await screen.findByRole('switch', {
      name: 'Start at login',
    })
    startAtLogin.click()
    await expect.poll(() => desktop.loginItem).toBe(true)

    fireEvent.change(screen.getByLabelText('Model'), {
      target: { value: 'gpt-test' },
    })
    await expect.poll(() => desktop.stored.model).toBe('gpt-test')
  })

  it('does not put the stored value back over what the user has typed', async () => {
    // The settings file opens when this window is already on screen, and a
    // free-text field is where that gap shows: the user can have typed a whole
    // Base URL into it before the file answers. Seeding the field then would
    // put the older value back under the cursor while the file already held
    // the new one — the two would disagree, and nothing would say so.
    const stored: Record<string, unknown> = {
      startAtLogin: false,
      modelBaseUrl: 'https://stale.example/v1',
      model: 'gpt-stored',
    }
    const deferred = deferredStore(stored)
    const desktop = fakeDesktop({
      stored,
      openSettingsStore: deferred.openSettingsStore,
    })

    showSettings(desktop)

    // The field is on screen at its default while the file is still opening.
    const baseUrl = screen.getByLabelText('Base URL') as HTMLInputElement
    fireEvent.change(baseUrl, { target: { value: 'http://localhost:11434/v1' } })

    deferred.openTheStore()
    await readLanded()

    expect(baseUrl.value).toBe('http://localhost:11434/v1')
    expect(stored.modelBaseUrl).toBe('http://localhost:11434/v1')
  })

  it('leaves the unsaved field named while the other one saves', async () => {
    // Two fields, two writes, and only one of them failing. A line about Base
    // URL must not be answered by a keystroke in Model: the file still does
    // not hold the Base URL the user is looking at.
    const stored: Record<string, unknown> = { startAtLogin: false }
    // The file stops refusing once the user has been told, so the line has a
    // way to go away that is not "close the window".
    let refusingBaseUrl = true
    const desktop = fakeDesktop({
      stored,
      openSettingsStore: async () => ({
        async get<T>(key: string) {
          return stored[key] as T | undefined
        },
        async has(key: string) {
          return key in stored
        },
        async set(key: string, value: unknown) {
          // The one field the settings file will not take.
          if (key === 'modelBaseUrl' && refusingBaseUrl) {
            throw new Error('the file is read-only')
          }
          stored[key] = value
        },
      }),
    })

    showSettings(desktop)

    fireEvent.change(await screen.findByLabelText('Base URL'), {
      target: { value: 'http://localhost:11434/v1' },
    })
    await screen.findByText(/could not be saved/)

    fireEvent.change(screen.getByLabelText('Model'), {
      target: { value: 'llama3.1' },
    })

    await expect.poll(() => stored.model).toBe('llama3.1')
    // Every settled write has had its say before the window is read: the
    // state updates behind them are promise callbacks, and a macrotask runs
    // once the whole microtask queue is drained.
    await new Promise((resolve) => setTimeout(resolve, 0))

    // The Model write succeeded; the Base URL is still not in the file.
    expect(stored.modelBaseUrl).toBe(undefined)
    const said = screen.queryAllByRole('alert').map((line) => line.textContent)
    expect(
      said.join(' | '),
      'a keystroke in Model answered a line about Base URL',
    ).toMatch(/could not be saved/)
    // And the line says which field, so the user knows what to try again.
    expect(said.join(' | ')).toMatch(/Base URL/)

    // Trying again is what takes the line away.
    refusingBaseUrl = false
    fireEvent.change(screen.getByLabelText('Base URL'), {
      target: { value: 'http://localhost:11434/v2' },
    })

    await expect
      .poll(() => screen.queryAllByRole('alert').length)
      .toBe(0)
    expect(stored.modelBaseUrl).toBe('http://localhost:11434/v2')
  })

  it('keeps Clear after a Keychain call that failed on its own', async () => {
    // The key is known to be there: the mount read succeeded. A later call
    // failing says the Keychain is busy or locked right now, not that the key
    // has stopped existing — and Clear is the only way out of an entry that
    // outlives an uninstall, so it must survive a failure the user can retry.
    const desktop = fakeDesktop({
      stored: { startAtLogin: false },
      apiKey: 'sk-from-an-earlier-run',
    })

    showSettings(desktop)

    const clear = await screen.findByRole('button', { name: 'Clear' })
    desktop.keychainRefuses = true
    clear.click()

    await screen.findByText(/the keychain could not be reached/)
    expect(desktop.apiKey).toBe('sk-from-an-earlier-run')
    // Still on screen, so the user can unlock the Keychain and press it again.
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeTruthy()

    desktop.keychainRefuses = false
    screen.getByRole('button', { name: 'Clear' }).click()

    await expect.poll(() => desktop.apiKey).toBe(null)
    await screen.findByText(/No key is saved/)
  })
})
