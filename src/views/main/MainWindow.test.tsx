// @vitest-environment jsdom

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { fakeDesktop } from '@/platform/testing/desktop'
import {
  closeTestDatabases,
  firstListShown,
  installMeasurementStubs,
  journalHolding,
} from '@/views/history/testing/history-view'
import MainWindow from './MainWindow'

// The Main Window as the user meets it: a sidebar naming the section on
// screen, and History inside it, reading the journal exactly as it read it
// when it had a window of its own.

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
    await showMainWindow([{ at: '2026-03-09T10:00:00', body: 'Monday' }])

    expect(await screen.findByText('Monday')).toBeTruthy()
    // History's own header, untouched by the sidebar beside it.
    const header = screen.getByRole('banner')
    expect(within(header).getByLabelText('Search')).toBeTruthy()
    expect(within(header).getByRole('button', { name: /^Days/ })).toBeTruthy()
  })

  it('names the section on screen and marks it as the current one', async () => {
    await showMainWindow([{ at: '2026-03-09T10:00:00', body: 'Monday' }])

    const history = within(sidebar()).getByRole('button', { name: 'History' })
    expect(history.getAttribute('aria-current')).toBe('page')
  })

  it('puts every section a Tab away, as an ordinary button', async () => {
    await showMainWindow([{ at: '2026-03-09T10:00:00', body: 'Monday' }])

    const history = within(sidebar()).getByRole('button', { name: 'History' })
    // Nothing takes the section out of the tab order or rebinds a key to
    // reach it: the sidebar is a short list of named places.
    expect(history.tabIndex).toBe(0)
    expect(history.getAttribute('disabled')).toBeNull()
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
  const { driver, core } = await journalHolding(captured)

  render(
    <MainWindow
      desktop={fakeDesktop({ driver })}
      journal={Promise.resolve(core)}
    />,
  )
  await firstListShown(captured.length)

  return { core }
}

/** The sidebar, as the only thing on screen that lists the sections. */
function sidebar(): HTMLElement {
  return screen.getByRole('navigation', { name: 'Sections' })
}
