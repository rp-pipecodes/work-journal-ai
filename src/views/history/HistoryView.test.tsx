// @vitest-environment jsdom

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fakeDesktop } from '@/platform/testing/desktop'
import { createJournal, journalDayFor, type Note } from '@/journal/journal'
import { fixedClock, openTestDatabase } from '@/journal/testing/database'
import HistoryView from './HistoryView'
import { formatDayRange } from './range-label'

// The Filter's header as the reader meets it: a click on the days, a Project
// chosen, a term typed — over a real journal, asserting on what is on screen.
// The list below it belongs to other tests; nothing here reads a Note row.

const openDatabases: Array<() => void> = []

// Base UI positions its popups against measured elements, and jsdom measures
// nothing and ships neither observer.
beforeAll(installMeasurementStubs)

afterEach(() => {
  cleanup()
  for (const close of openDatabases.splice(0)) close()
  vi.restoreAllMocks()
})

describe('the day axis', () => {
  it('is one control reading the current range in words', async () => {
    const { days } = await showHistory([
      { at: '2026-03-09T10:00:00', body: 'Monday' },
    ])

    expect(days().textContent).toContain(
      formatDayRange('2026-03-09', '2026-03-09'),
    )
  })

  it('leaves no native picker in the header', async () => {
    await showHistory([{ at: '2026-03-09T10:00:00', body: 'Monday' }])

    const header = screen.getByRole('banner')
    expect(header.querySelector('select')).toBeNull()
    expect(header.querySelector('input[type="date"]')).toBeNull()
  })

  it('moves the Filter to the range picked on its calendar', async () => {
    const user = userEvent.setup()
    const { days } = await showHistory([
      { at: '2026-03-09T10:00:00', body: 'Monday' },
      { at: '2026-03-11T10:00:00', body: 'Wednesday' },
    ])

    await user.click(days())
    await user.click(await dayCell('2026-03-09'))
    await user.click(await dayCell('2026-03-11'))

    expect(await screen.findByText('Monday')).toBeTruthy()
    expect(screen.getByText('Wednesday')).toBeTruthy()
    expect(days().textContent).toContain(
      formatDayRange('2026-03-09', '2026-03-11'),
    )
  })
})

describe('a Preset', () => {
  it('sets the days once and is then forgotten', async () => {
    const user = userEvent.setup()
    const { days } = await showHistory([
      { at: '2026-03-09T10:00:00', body: 'Monday' },
    ])
    const today = journalDayFor(new Date())

    await user.click(days())
    await user.click(screen.getByRole('button', { name: 'Today' }))

    // What the control reads is the range that was picked, not the name of
    // the Preset that picked it.
    expect(days().textContent).toContain(formatDayRange(today, today))
    expect(days().textContent).not.toContain('Today')
  })

  it('never touches the Project constraint', async () => {
    const user = userEvent.setup()
    const { days, project } = await showHistory([
      { at: '2026-03-09T10:00:00', body: '#alpha Monday' },
    ])

    await user.click(project())
    await user.click(await screen.findByRole('option', { name: '#alpha' }))
    await user.click(days())
    await user.click(screen.getByRole('button', { name: 'Yesterday' }))

    expect(project().textContent).toContain('#alpha')
  })
})

describe('the Project constraint', () => {
  it('still offers the Project it is narrowed to when no Note carries it', async () => {
    const user = userEvent.setup()
    const { project, desktop, core, notes } = await showHistory([
      { at: '2026-03-09T10:00:00', body: '#alpha Monday' },
    ])

    await user.click(project())
    await user.click(await screen.findByRole('option', { name: '#alpha' }))
    expect(project().textContent).toContain('#alpha')

    // The last Note under it goes, from another window; the constraint stands,
    // so the picker has to keep saying what the empty list is narrowed to.
    await core.delete(notes[0].id)
    await desktop.announceJournalChanged()

    await user.click(project())
    expect(await screen.findByRole('option', { name: '#alpha' })).toBeTruthy()
  })
})

describe('Copy Digest', () => {
  it('reports through a toast, and says so politely as well', async () => {
    const user = userEvent.setup()
    const { desktop } = await showHistory([
      { at: '2026-03-09T10:00:00', body: 'Monday' },
    ])

    await user.click(screen.getByRole('button', { name: /copy digest/i }))

    const said = await screen.findByRole('status')
    expect(said.getAttribute('aria-live')).toBe('polite')
    await vi.waitFor(() => expect(said.textContent).not.toBe(''))
    expect(desktop.clipboard).toContain('Monday')

    // The same words the live region carries, up on screen as a toast.
    const toast = await vi.waitFor(() => {
      const found = document.querySelector('[data-sonner-toast]')
      if (found === null) throw new Error('no toast')
      return found
    })
    expect(toast.textContent).toContain(said.textContent)
  })

  it('is not offered while a Search is showing', async () => {
    const user = userEvent.setup()
    await showHistory([{ at: '2026-03-09T10:00:00', body: 'Monday' }])

    await user.type(within(header()).getByLabelText('Search'), 'Mon')

    await vi.waitFor(() => {
      expect(screen.queryByRole('button', { name: /copy digest/i })).toBeNull()
    })
  })
})

describe('every filter control', () => {
  it('says what it is to a screen reader', async () => {
    await showHistory([{ at: '2026-03-09T10:00:00', body: 'Monday' }])

    expect(within(header()).getByLabelText('Days')).toBeTruthy()
    expect(within(header()).getByLabelText('Project')).toBeTruthy()
    expect(within(header()).getByLabelText('Search')).toBeTruthy()
  })
})

describe('Escape', () => {
  it('clears a Search before it closes the window', async () => {
    const user = userEvent.setup()
    const { desktop } = await showHistory([
      { at: '2026-03-09T10:00:00', body: 'Monday' },
    ])
    const closed = vi.spyOn(desktop, 'closeWindow')

    const search = within(header()).getByLabelText('Search') as HTMLInputElement
    await user.type(search, 'Mon')
    await vi.waitFor(() => {
      expect(screen.queryByRole('button', { name: /copy digest/i })).toBeNull()
    })

    await user.keyboard('{Escape}')
    await vi.waitFor(() => expect(search.value).toBe(''))
    expect(closed).not.toHaveBeenCalled()

    await user.keyboard('{Escape}')
    expect(closed).toHaveBeenCalled()
  })

  it('closes an open day picker without closing the window', async () => {
    const user = userEvent.setup()
    const { desktop, days } = await showHistory([
      { at: '2026-03-09T10:00:00', body: 'Monday' },
    ])
    const closed = vi.spyOn(desktop, 'closeWindow')

    await user.click(days())
    await screen.findByRole('button', { name: 'Today' })

    await user.keyboard('{Escape}')

    await vi.waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Today' })).toBeNull()
    })
    expect(closed).not.toHaveBeenCalled()
  })
})

/** History over a real journal, opened and already showing its first list. */
async function showHistory(captured: Array<{ at: string; body: string }>) {
  const { driver, close } = await openTestDatabase()
  openDatabases.push(close)

  const clock = fixedClock(new Date('2026-03-09T10:00:00'))
  const core = createJournal({ clock, driver })

  const notes: Note[] = []
  for (const { at, body } of captured) {
    clock.set(new Date(at))
    const note = await core.capture(body)
    if (note === null) throw new Error('nothing was captured')
    notes.push(note)
  }

  const desktop = fakeDesktop({ driver })
  render(<HistoryView desktop={desktop} journal={Promise.resolve(core)} />)

  // The first read has to have landed: until it does there is no Filter, and
  // the header is not on screen at all.
  await screen.findByRole('banner')

  return {
    desktop,
    core,
    notes,
    // Scoped to the header: a Note row has a Project of its own, and this
    // file is about the Filter.
    days: () => within(header()).getByLabelText('Days'),
    project: () => within(header()).getByLabelText('Project'),
  }
}

/** The Filter's header, which is the whole of what this file is about. */
function header(): HTMLElement {
  return screen.getByRole('banner')
}

/** A day on the open calendar, pointed at the way a reader points at one. */
async function dayCell(journalDay: string): Promise<HTMLElement> {
  const [year, month, day] = journalDay.split('-').map(Number)
  const stamp = new Date(year, month - 1, day).toLocaleDateString()

  return await vi.waitFor(() => {
    const cell = document.querySelector(`[data-day="${stamp}"]`)
    if (cell === null) throw new Error(`no ${journalDay} on the calendar`)
    return cell as HTMLElement
  })
}

/**
 * What jsdom does not implement and a positioned popup needs. Stubs rather
 * than a library: these tests assert on what is on screen, never on where.
 */
function installMeasurementStubs() {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver

  Element.prototype.scrollIntoView ??= () => {}

  globalThis.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof matchMedia
}
