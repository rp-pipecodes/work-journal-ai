// @vitest-environment jsdom

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createJournal } from '@/journal/journal'
import { fixedClock, openTestDatabase } from '@/journal/testing/database'
import { fakeDesktop } from '@/platform/testing/desktop'
import { installMeasurementStubs } from '@/views/history/testing/history-view'
import MainWindow from './MainWindow'

// The Main Window as the user meets it: a sidebar naming the section on
// screen, and History inside it, reading the same journal it read when it had
// a window of its own.

beforeAll(installMeasurementStubs)

const openDatabases: Array<() => void> = []

afterEach(() => {
  cleanup()
  for (const close of openDatabases.splice(0)) close()
  vi.restoreAllMocks()
})

describe('the Main Window', () => {
  it('opens on History, with the Notes already read back', async () => {
    await showMainWindow([{ at: '2026-03-09T10:00:00', body: 'Monday' }])

    expect(await screen.findByText('Monday')).toBeTruthy()
    // History's own header, unchanged by the sidebar around it.
    expect(within(screen.getByRole('banner')).getByLabelText('Search')).toBeTruthy()
  })

  it('names the section on screen and marks it as the current one', async () => {
    await showMainWindow([{ at: '2026-03-09T10:00:00', body: 'Monday' }])

    const history = within(sidebar()).getByRole('button', { name: 'History' })
    expect(history.getAttribute('aria-current')).toBe('page')
  })

  it('puts the sidebar a keystroke away, with the current section reachable', async () => {
    const user = await showMainWindow([
      { at: '2026-03-09T10:00:00', body: 'Monday' },
    ])

    const history = within(sidebar()).getByRole('button', { name: 'History' })
    // One tab stop for the list, on the section showing: the arrow keys move
    // along it, so Tab out of the sidebar reaches the section itself.
    expect(history.tabIndex).toBe(0)

    history.focus()
    await user.keyboard('{ArrowDown}')
    // With History the only section there is, the list stays where it is
    // rather than losing focus off its end.
    expect(document.activeElement).toBe(history)
  })

  it('leaves the traffic lights the sidebar’s top row', async () => {
    await showMainWindow([{ at: '2026-03-09T10:00:00', body: 'Monday' }])

    // The title bar is an overlay drawn over the window's top-left corner,
    // which is over the sidebar rather than over the section.
    expect(sidebar().firstElementChild?.getAttribute('data-slot')).toBe(
      'window-title-bar',
    )
  })
})

/** The Main Window over a real journal, already showing its first list. */
async function showMainWindow(captured: Array<{ at: string; body: string }>) {
  const { driver, close } = await openTestDatabase()
  openDatabases.push(close)

  const clock = fixedClock(new Date('2026-03-09T10:00:00'))
  const core = createJournal({ clock, driver })

  for (const { at, body } of captured) {
    clock.set(new Date(at))
    if ((await core.capture(body)) === null) {
      throw new Error('nothing was captured')
    }
  }

  const user = userEvent.setup()
  render(
    <MainWindow desktop={fakeDesktop({ driver })} journal={Promise.resolve(core)} />,
  )

  // The first read has to have landed: until it does History has no Filter,
  // and its header is not on screen at all.
  if (captured.length > 0) await screen.findByRole('banner')

  return user
}

/** The sidebar, as the only thing on screen that lists the sections. */
function sidebar(): HTMLElement {
  return screen.getByRole('navigation', { name: 'Sections' })
}
