// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { fakeDesktop, type FakeDesktop } from '@/platform/testing/desktop'
import { createAppSettings } from '@/settings/app-settings'
import type { Journal } from '@/journal/journal'
import SettingsView from './SettingsView'

// Settings as the user meets it. The one seam that cannot be driven from Node:
// what the toggle reads, and what pressing it means, are decided in the view,
// so the view is where it has to be pressed.

afterEach(cleanup)

/**
 * Settings over a fake desktop. Export is the only thing here that reaches the
 * journal, and nothing below presses it, so that promise never has to settle.
 */
function showSettings(desktop: FakeDesktop) {
  render(
    <SettingsView
      desktop={desktop}
      settings={createAppSettings(desktop)}
      journal={new Promise<Journal>(() => {})}
    />,
  )
}

/** The Import toggle, found the way the user finds it. */
function importToggle(): HTMLInputElement {
  return screen.getByLabelText(
    "Add today's meetings to the journal",
  ) as HTMLInputElement
}

describe('the Import toggle', () => {
  it('withdraws the wish when pressed with the calendar permission gone', async () => {
    // The wish outlives a lost permission, which is what makes the reason
    // sayable — but it must not outlive the user changing their mind. The
    // toggle already reads off, so pressing it can only mean "stop wishing".
    const desktop = fakeDesktop({
      stored: { importMeetings: true },
      access: 'denied',
    })

    showSettings(desktop)

    // The mount effect has to have read the store and the access status.
    await screen.findByText(/calendar/i)
    expect(importToggle().checked).toBe(false)

    importToggle().click()

    await expect.poll(() => desktop.stored.importMeetings).toBe(false)
    expect(importToggle().checked).toBe(false)
  })
})
