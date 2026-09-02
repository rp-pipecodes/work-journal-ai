// @vitest-environment jsdom

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { toast } from 'sonner'
import {
  deferredStore,
  fakeDesktop,
  type FakeDesktop,
} from '@/platform/testing/desktop'
import ThemeProvider from '@/components/ThemeProvider'
import { createAppSettings } from '@/settings/app-settings'
import type { Journal, JournalExport } from '@/journal/journal'
import { DEFAULT_STANDUP_PROMPT } from '@/settings/settings'
import SettingsView from './SettingsView'

// Settings as the user meets it. The one seam that cannot be driven from Node:
// what a control reads, and what pressing it means, are decided in the view, so
// the view is where it has to be pressed.

afterEach(() => {
  cleanup()
  // Sonner keeps its messages outside React, so unmounting the window leaves
  // them standing for the next one to draw.
  toast.dismiss()
})

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

/**
 * What the toasts on screen say. A save's confirmation is a toast, and the
 * Toaster is mounted once for the whole view, so what it draws is what the
 * user has been told.
 */
function toasts(): string[] {
  return [...document.querySelectorAll('[data-sonner-toast]')].map(
    (toast) => toast.textContent ?? '',
  )
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

  it('says a switch press as saved even when its announcement could not be sent', async () => {
    // The emit that keeps the other windows honest is not what saves: a
    // failed one leaves the file written and the wish standing, and the
    // window that sweeps catches up at its next read. Told as refused, the
    // toast would contradict the switch it sits beside.
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

    // The wish is in the file, and the switch agrees with it — said as saved,
    // not rolled back.
    expect(isOn(importSwitch())).toBe(true)
    await expect.poll(() => desktop.stored.importMeetings).toBe(true)
    await expect
      .poll(() => toasts().join(' | '))
      .toBe('Meetings will be imported.')
  })

  it('keeps a calendar tick after its save failed', async () => {
    // A tick the file refused is said as refused, and the ticks read what
    // the file holds: the rollback re-reads it, so the tick the user sees
    // agrees with the file even when the file said no.
    const stored: Record<string, unknown> = {
      importMeetings: true,
      importCalendars: ['work'],
      startAtLogin: false,
      model: 'gpt-stored',
    }
    const desktop = fakeDesktop({
      stored,
      access: 'granted',
      calendars: [{ id: 'work', title: 'Work', source: 'iCloud' }],
      openSettingsStore: async () => ({
        async get<T>(key: string) {
          return stored[key] as T | undefined
        },
        async has(key: string) {
          return key in stored
        },
        async set(key: string, value: unknown) {
          // The one write the settings file will not take.
          if (key === 'importCalendars') {
            throw new Error('the file is read-only')
          }
          stored[key] = value
        },
      }),
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    showSettings(desktop)

    const work = await screen.findByRole('checkbox', { name: /Work/ })
    work.click()

    await expect
      .poll(() => toasts().join(' | '))
      .toBe('Could not save which calendars to import.')
    // The rollback re-read what the file holds — the tick as an earlier run
    // left it — and the ticks agree with the file, not with the refused press.
    expect(isOn(screen.getByRole('checkbox', { name: /Work/ }))).toBe(true)
    expect(desktop.stored.importCalendars).toEqual(['work'])
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

  it('discards an older Start at Login rollback still in flight when a newer press lands', async () => {
    // Press A turns the switch on: the OS accepts, then the file write
    // refuses, so the rollback re-reads the OS. The read is serviced before
    // press B turns it off again, and resolves after — the older rollback's
    // captured true must not be put back over the newer change, or the
    // switch would read on while the OS and the file held false.
    const stored: Record<string, unknown> = {
      startAtLogin: false,
      model: 'gpt-stored',
    }
    // The file takes the first start-at-login write and refuses it.
    let startAtLoginWrites = 0
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
          if (key === 'startAtLogin') {
            startAtLoginWrites += 1
            if (startAtLoginWrites === 1) {
              throw new Error('the file is read-only')
            }
          }
          stored[key] = value
        },
      }),
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    // The OS read for press A's rollback: serviced now, delivered when the
    // test says so. Any other read is answered immediately.
    let releaseRead = () => {}
    const readAnswered = new Promise<void>((resolve) => {
      releaseRead = resolve
    })
    let gated = false
    let captured: boolean | null = null
    desktop.startsAtLogin = () => {
      const value = desktop.loginItem
      if (!gated) return Promise.resolve(value)
      gated = false
      captured = value
      return readAnswered.then(() => value)
    }

    showSettings(desktop)

    const control = await screen.findByRole('switch', {
      name: 'Start at login',
    })
    expect(isOn(control)).toBe(false)

    // Press A: the login item moves, the file write refuses, and the
    // rollback's read is now in flight.
    control.click()
    gated = true
    await expect.poll(() => captured).toBe(true)

    // Press B: off, and this write reaches the file.
    control.click()
    await expect.poll(() => desktop.stored.startAtLogin).toBe(false)

    releaseRead()

    // The rollback's delivery has had its chance by the time a macrotask
    // runs — its state update is a microtask, and it is discarded, so the
    // switch still agrees with the OS and the file.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(desktop.loginItem).toBe(false)
    expect(
      isOn(screen.getByRole('switch', { name: 'Start at login' })),
    ).toBe(false)
    expect(desktop.stored.startAtLogin).toBe(false)
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

describe('Updates', () => {
  /** The line the Updates group keeps saying, found inside that group alone. */
  function updateStatus(): string | null | undefined {
    return screen
      .getByRole('heading', { name: 'Updates' })
      .closest('section')
      ?.querySelector('p[role="status"]')?.textContent
  }

  it('says the build is current when nothing newer has been released', async () => {
    const desktop = fakeDesktop({ stored: { startAtLogin: false } })

    showSettings(desktop)

    const button = await screen.findByRole('button', {
      name: 'Check for updates',
    })
    button.click()

    await expect.poll(updateStatus).toBe('Work Journal is up to date.')
    // Nothing to install, so the control stays the one that looks again.
    expect(
      screen.getByRole('button', { name: 'Check for updates' }),
    ).toBeTruthy()
    expect(desktop.updatesInstalled).toBe(0)
  })

  it('names the release found and installs that one when pressed', async () => {
    const desktop = fakeDesktop({ stored: { startAtLogin: false } })
    desktop.availableUpdate = { version: '0.9.0' }

    showSettings(desktop)

    ;(await screen.findByRole('button', { name: 'Check for updates' })).click()

    // The version is named before anything is downloaded: what is about to
    // replace the running build is worth reading first.
    await expect
      .poll(updateStatus)
      .toBe('Work Journal 0.9.0 is available.')
    const install = await screen.findByRole('button', {
      name: 'Install 0.9.0',
    })

    install.click()

    await expect
      .poll(() => desktop.updatesInstalled)
      .toBe(1)
    await expect
      .poll(updateStatus)
      .toBe('Work Journal 0.9.0 is installed. Restarting…')
    // The toast says it too, in its own layer.
    expect(
      document.querySelector('[data-sonner-toaster]')?.textContent,
    ).toMatch(/0\.9\.0 is installed/)
  })

  it('says so when nothing could be reached, and offers to look again', async () => {
    const desktop = fakeDesktop({ stored: { startAtLogin: false } })
    desktop.updateCheckFails = true

    showSettings(desktop)

    ;(await screen.findByRole('button', { name: 'Check for updates' })).click()

    await expect.poll(updateStatus).toBe('Could not check for updates.')
    expect(
      screen.getByRole('button', { name: 'Check for updates' }),
    ).toBeTruthy()
  })

  it('names the version that could not be installed, and keeps it installable', async () => {
    const desktop = fakeDesktop({ stored: { startAtLogin: false } })
    desktop.availableUpdate = { version: '0.9.0' }
    desktop.updateInstallFails = true

    showSettings(desktop)

    ;(await screen.findByRole('button', { name: 'Check for updates' })).click()
    ;(await screen.findByRole('button', { name: 'Install 0.9.0' })).click()

    await expect
      .poll(updateStatus)
      .toBe('Could not install Work Journal 0.9.0.')
    // A failed install leaves the release found: the way to try again is the
    // same press, not another look.
    expect(screen.getByRole('button', { name: 'Install 0.9.0' })).toBeTruthy()
  })

  it('shows how much of the download has arrived while it is arriving', async () => {
    const desktop = fakeDesktop({ stored: { startAtLogin: false } })
    desktop.availableUpdate = { version: '0.9.0' }
    // A download that never finishes, so the wait itself can be read.
    desktop.installUpdate = async (report) => {
      report({ downloaded: 5_000_000, total: 20_000_000 })
      return new Promise<void>(() => {})
    }

    showSettings(desktop)

    ;(await screen.findByRole('button', { name: 'Check for updates' })).click()
    ;(await screen.findByRole('button', { name: 'Install 0.9.0' })).click()

    await screen.findByRole('button', { name: 'Downloading… 25%' })
  })
})

describe('save confirmations', () => {
  it('says what a Start at Login press did', async () => {
    const desktop = fakeDesktop({ stored: { startAtLogin: false } })

    showSettings(desktop)

    const control = await screen.findByRole('switch', {
      name: 'Start at login',
    })
    control.click()

    await expect
      .poll(() => toasts().join(' | '))
      .toBe('Work Journal will start at login.')
  })

  it('replaces one field’s toast rather than stacking one per keystroke', async () => {
    const desktop = fakeDesktop({ stored: { startAtLogin: false } })

    showSettings(desktop)

    const model = await screen.findByLabelText('Model')
    fireEvent.change(model, { target: { value: 'llama3' } })
    fireEvent.change(model, { target: { value: 'llama3.1' } })
    fireEvent.change(model, { target: { value: 'llama3.2' } })

    await expect
      .poll(() => toasts().join(' | '))
      .toBe('Model saved.')
    expect((model as HTMLInputElement).value).toBe('llama3.2')
    expect(desktop.stored.model).toBe('llama3.2')
  })

  it('says which field refused, beside the line that stays', async () => {
    const stored: Record<string, unknown> = { startAtLogin: false }
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
          if (key === 'modelBaseUrl') throw new Error('the file is read-only')
          stored[key] = value
        },
      }),
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    showSettings(desktop)

    fireEvent.change(await screen.findByLabelText('Base URL'), {
      target: { value: 'http://localhost:11434/v1' },
    })

    await expect
      .poll(() => toasts().join(' | '))
      .toBe('Could not save the Base URL.')
    // The toast fades; this is where the answer stays for whoever comes back.
    expect(screen.queryAllByRole('alert').map((line) => line.textContent)).toContain(
      'Base URL could not be saved to the settings file, so it will be gone at the next launch.',
    )
  })

  it('confirms the Theme and says so when the store refuses it', async () => {
    const stored: Record<string, unknown> = { startAtLogin: false }
    // The store takes the first Theme and refuses the second, so the test
    // sees both outcomes through one window.
    let refusingTheme = false
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
          if (key === 'theme' && refusingTheme) {
            throw new Error('the file is read-only')
          }
          stored[key] = value
        },
      }),
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    showSettings(desktop)

    screen.getByRole('button', { name: 'Dark' }).click()
    await expect.poll(() => toasts().join(' | ')).toBe('Theme saved.')

    refusingTheme = true
    screen.getByRole('button', { name: 'Light' }).click()
    await expect
      .poll(() => toasts().join(' | '))
      .toBe('Could not save the Theme.')
  })

  it('confirms a Hotkey remap, and a refused one, by the setting’s own name', async () => {
    const desktop = fakeDesktop({ stored: { startAtLogin: false } })

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

    await expect
      .poll(() => toasts().join(' | '))
      .toBe('Note Hotkey saved.')

    // The refusal names it the same way, against the right action, and
    // replaces the confirmation rather than stacking beside it — one toast
    // per Hotkey, not one per remap. The completed remap re-rendered the
    // row, so the Change button is found again rather than pressed where
    // it used to be.
    desktop.setHotkey = () =>
      Promise.reject(new Error('it is already the Task Hotkey'))
    screen.getByRole('button', { name: 'Change Note Hotkey' }).click()
    const listening = await screen.findByRole('button', {
      name: 'Press a combination…',
    })
    listening.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'L',
        code: 'KeyL',
        ctrlKey: true,
        metaKey: true,
        bubbles: true,
      }),
    )

    await expect
      .poll(() => toasts().join(' | '))
      .toBe('Could not save the Note Hotkey.')

    // The other Hotkey has a toast of its own: the two are independent
    // settings and never share one.
    desktop.setHotkey = async (action, next) => ({
      ...(await desktop.hotkeyStatus()),
      [action]: { state: 'registered' as const, hotkey: next },
    })
    screen.getByRole('button', { name: 'Change Task Hotkey' }).click()
    const taskRecording = await screen.findByRole('button', {
      name: 'Press a combination…',
    })
    taskRecording.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'T',
        code: 'KeyT',
        ctrlKey: true,
        metaKey: true,
        bubbles: true,
      }),
    )

    await expect
      .poll(() => toasts().join(' | '))
      .toBe('Task Hotkey saved. | Could not save the Note Hotkey.')
  })

  it('confirms an API Key put in the Keychain, and one taken out', async () => {
    const desktop = fakeDesktop({
      stored: { startAtLogin: false },
      apiKey: 'sk-from-an-earlier-run',
    })

    showSettings(desktop)

    await screen.findByText(/A key is saved/)
    screen.getByRole('button', { name: 'Clear' }).click()
    await expect.poll(() => toasts().join(' | ')).toBe('API Key removed.')

    fireEvent.change(screen.getByLabelText('API Key'), {
      target: { value: 'sk-a-new-key' },
    })
    screen.getByRole('button', { name: 'Save' }).click()
    await expect.poll(() => toasts().join(' | ')).toBe('API Key saved.')
  })

  it('says what pressing the Import switch did, both ways', async () => {
    const desktop = fakeDesktop({
      stored: { importMeetings: false, startAtLogin: false },
      access: 'granted',
      calendars: [{ id: 'work', title: 'Work', source: 'iCloud' }],
    })

    showSettings(desktop)

    // On, over a permission already granted: no ask, just the wish.
    importSwitch().click()
    await expect.poll(() => toasts().join(' | ')).toBe('Meetings will be imported.')
    await expect.poll(() => desktop.stored.importMeetings).toBe(true)

    // Off again: the same toast says the opposite, not a second one — the
    // switch has one id, and its press replaces what the last press said.
    importSwitch().click()
    await expect
      .poll(() => toasts().join(' | '))
      .toBe('Meetings will no longer be imported.')
    await expect.poll(() => desktop.stored.importMeetings).toBe(false)
  })

  it('says the wish is kept when macOS refuses the calendars', async () => {
    const desktop = fakeDesktop({
      stored: { importMeetings: false, startAtLogin: false },
      access: 'denied',
    })

    showSettings(desktop)

    // Pressed against a refusal: the wish is stored anyway, and the toast
    // says what the press did — that Import starts the moment macOS allows
    // calendars, not that the press did nothing.
    importSwitch().click()

    await expect
      .poll(() => toasts().join(' | '))
      .toBe('Meetings will be imported once macOS allows calendars.')
    await expect.poll(() => desktop.stored.importMeetings).toBe(true)
    // The toast and the line underneath agree: the switch reads off while
    // the reason for it stays on screen.
    expect(screen.getByText(/not allowing Work Journal to read/)).toBeTruthy()
    expect(isOn(importSwitch())).toBe(false)
  })

  it('says so when the Import save itself refuses', async () => {
    // A write the file refuses is a save that did not happen: the toast says
    // so, and the rollback leaves the switch agreeing with the file.
    const stored: Record<string, unknown> = {
      importMeetings: false,
      startAtLogin: false,
      model: 'gpt-stored',
    }
    const desktop = fakeDesktop({
      stored,
      access: 'granted',
      openSettingsStore: async () => ({
        async get<T>(key: string) {
          return stored[key] as T | undefined
        },
        async has(key: string) {
          return key in stored
        },
        async set(key: string, value: unknown) {
          // The one write the settings file will not take.
          if (key === 'importMeetings') {
            throw new Error('the file is read-only')
          }
          stored[key] = value
        },
      }),
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    showSettings(desktop)

    importSwitch().click()

    await expect
      .poll(() => toasts().join(' | '))
      .toBe('Could not change how meetings are imported.')
    // Nothing took: the switch reads the file, not the refused press.
    await expect.poll(() => isOn(importSwitch())).toBe(false)
    expect(desktop.stored.importMeetings).toBe(false)
  })

  it('confirms a calendar tick', async () => {
    const desktop = fakeDesktop({
      stored: { importMeetings: true, importCalendars: [], startAtLogin: false },
      access: 'granted',
      calendars: [{ id: 'work', title: 'Work', source: 'iCloud' }],
    })

    showSettings(desktop)

    const work = await screen.findByRole('checkbox', { name: /Work/ })
    work.click()

    await expect.poll(() => toasts().join(' | ')).toBe('Calendars saved.')
  })

  it('confirms a Standup Prompt keystroke', async () => {
    const desktop = fakeDesktop({ stored: { startAtLogin: false } })

    showSettings(desktop)

    fireEvent.change(await screen.findByLabelText('Standup Prompt'), {
      target: { value: 'Write it in pirate speak.' },
    })

    await expect
      .poll(() => toasts().join(' | '))
      .toBe('Standup Prompt saved.')
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

describe('the Standup Prompt', () => {
  it('opens on the shipped prompt, and remembers what is typed', async () => {
    const desktop = fakeDesktop({ stored: { startAtLogin: false } })

    showSettings(desktop)

    const prompt = await screen.findByLabelText('Standup Prompt')
    // The user starts from the shipped prompt rather than from a blank box.
    expect((prompt as HTMLTextAreaElement).value).toBe(DEFAULT_STANDUP_PROMPT)

    fireEvent.change(prompt, {
      target: { value: 'Write it in pirate speak.' },
    })

    await expect.poll(() => desktop.stored.standupPrompt).toBe(
      'Write it in pirate speak.',
    )
  })

  it('opens on what an earlier run stored', async () => {
    const desktop = fakeDesktop({
      stored: {
        startAtLogin: false,
        standupPrompt: 'Write it in pirate speak.',
      },
    })

    showSettings(desktop)

    const prompt = (await screen.findByLabelText(
      'Standup Prompt',
    )) as HTMLTextAreaElement
    // The same value survives a restart: the field opens already holding it.
    await expect.poll(() => prompt.value).toBe('Write it in pirate speak.')
  })

  it('puts the shipped prompt back when Restore Default is pressed', async () => {
    const desktop = fakeDesktop({
      stored: {
        startAtLogin: false,
        standupPrompt: 'Write it in pirate speak.',
      },
    })

    showSettings(desktop)

    fireEvent.change(await screen.findByLabelText('Standup Prompt'), {
      target: { value: 'Write it in pirate speak.' },
    })
    await expect.poll(() => desktop.stored.standupPrompt).toBe(
      'Write it in pirate speak.',
    )

    screen.getByRole('button', { name: 'Restore Default' }).click()

    await expect.poll(() => desktop.stored.standupPrompt).toBe(
      DEFAULT_STANDUP_PROMPT,
    )
    expect(
      (screen.getByLabelText('Standup Prompt') as HTMLTextAreaElement).value,
    ).toBe(DEFAULT_STANDUP_PROMPT)
  })

  it('treats a cleared field as the shipped prompt, not as silence', async () => {
    // Clearing the field writes the empty string: the settings file then
    // says "use the shipped prompt", and the empty string is restored to the
    // shipped prompt by the very first read after it.
    const desktop = fakeDesktop({ stored: { startAtLogin: false } })

    showSettings(desktop)

    fireEvent.change(await screen.findByLabelText('Standup Prompt'), {
      target: { value: '' },
    })

    await expect.poll(() => desktop.stored.standupPrompt).toBe('')
  })

  it('does not put the stored value back over what the user has typed', async () => {
    // The settings file opens when this window is already on screen, and the
    // prompt is a free-text field: the user can have typed a whole prompt
    // into it before the file answers. Seeding the field then would put the
    // older value back under the cursor while the file already held the new
    // one — the two would disagree, and nothing would say so.
    const stored: Record<string, unknown> = {
      startAtLogin: false,
      model: 'gpt-stored',
      standupPrompt: 'Write it in pirate speak.',
    }
    let openTheStore = () => {}
    const opened = new Promise<void>((resolve) => {
      openTheStore = resolve
    })

    const desktop = fakeDesktop({
      stored,
      openSettingsStore: async () => {
        await opened
        return {
          async get<T>(key: string) {
            return stored[key] as T | undefined
          },
          async has(key: string) {
            return key in stored
          },
          async set(key: string, value: unknown) {
            stored[key] = value
          },
        }
      },
    })

    showSettings(desktop)

    // The field is on screen at its default while the file is still opening.
    const prompt = screen.getByLabelText('Standup Prompt') as HTMLTextAreaElement
    fireEvent.change(prompt, {
      target: { value: 'typed before the file answered' },
    })

    openTheStore()

    // Model is seeded by the very same read, so its arrival is what says the
    // read has landed — no waiting on a clock.
    await expect
      .poll(() => (screen.getByLabelText('Model') as HTMLInputElement).value)
      .toBe('gpt-stored')

    expect(prompt.value).toBe('typed before the file answered')
    expect(stored.standupPrompt).toBe('typed before the file answered')
  })

  it('says when the prompt could not be saved', async () => {
    const stored: Record<string, unknown> = { startAtLogin: false }
    // The file stops refusing once the user has been told, so the line has a
    // way to go away that is not "close the window".
    let refusingPrompt = true
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
          if (key === 'standupPrompt' && refusingPrompt) {
            throw new Error('the file is read-only')
          }
          stored[key] = value
        },
      }),
    })

    showSettings(desktop)

    fireEvent.change(await screen.findByLabelText('Standup Prompt'), {
      target: { value: 'Write it in pirate speak.' },
    })
    await screen.findByText(/could not be saved/)

    // Trying again is what takes the line away.
    refusingPrompt = false
    fireEvent.change(screen.getByLabelText('Standup Prompt'), {
      target: { value: 'Write it anyway.' },
    })

    await expect
      .poll(() => screen.queryAllByRole('alert').length)
      .toBe(0)
    expect(stored.standupPrompt).toBe('Write it anyway.')
  })
})
