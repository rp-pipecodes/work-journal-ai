// @vitest-environment jsdom

import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { fakeDesktop, type FakeDesktop } from '@/platform/testing/desktop'
import ThemeProvider from '@/components/ThemeProvider'
import { createAppSettings } from '@/settings/app-settings'
import type { Digest, Journal } from '@/journal/journal'
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
function journalExporting(digest: Digest): Promise<Journal> {
  return Promise.resolve({
    exportAll: async () => digest,
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
    // The one place the window's dismissal reaches this view.
    let close: (() => void) | null = null
    desktop.onCloseRequested = async (closing) => {
      close = closing
      return () => {}
    }

    showSettings(desktop)

    await screen.findByText('Start Work Journal at login?')
    await expect.poll(() => close).not.toBe(null)

    close!()

    await expect.poll(() => desktop.stored.startAtLogin).toBe(false)
  })
})

describe('the Hotkey', () => {
  it('renders one chip per key rather than a single string', async () => {
    const desktop = fakeDesktop({
      stored: { startAtLogin: false },
      hotkey: { state: 'registered', hotkey: 'Cmd+Shift+J' },
    })

    showSettings(desktop)

    const chips = await screen.findByRole('group', { name: 'Current Hotkey' })
    expect(
      [...chips.querySelectorAll('kbd')].map((key) => key.textContent),
    ).toEqual(['Cmd', 'Shift', 'J'])
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

    const change = await screen.findByRole('button', { name: 'Change' })
    change.click()

    // The recorder owns Escape while it is listening: abandoning a
    // half-pressed combination must not take the window with it.
    const recorder = await screen.findByRole('button', {
      name: 'Press a combination…',
    })
    escape(recorder)
    expect(closed).toBe(0)

    // Abandoned, the window has Escape back.
    escape(await screen.findByRole('button', { name: 'Change' }))
    expect(closed).toBe(1)
  })
})

describe('Export', () => {
  it('reports through a toast and leaves the last export announced', async () => {
    const desktop = fakeDesktop({ stored: { startAtLogin: false } })

    showSettings(
      desktop,
      journalExporting({ markdown: '- a note', noteCount: 1 } as Digest),
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
    const announced = screen.getByRole('status', { name: 'Last export' })
    expect(announced.getAttribute('aria-live')).toBe('polite')
    expect(announced.textContent).toMatch(/Exported 1 Note to/)
  })
})

/** Escape, pressed where the user's focus is. */
function escape(element: HTMLElement) {
  element.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
  )
}
