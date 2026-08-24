// @vitest-environment jsdom

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { journalDayFor } from '@/journal/journal'
import {
  closeTestDatabases,
  dayCell,
  installMeasurementStubs,
  showHistory,
} from './testing/history-view'
import { formatDayRange } from './range-label'

// The Filter's header as the reader meets it: a click on the days, a Project
// chosen, a term typed — over a real journal, asserting on what is on screen.
// The list below it belongs to other tests; nothing here reads a Note row.

// Base UI positions its popups against measured elements, and jsdom measures
// nothing and ships neither observer.
beforeAll(installMeasurementStubs)

afterEach(() => {
  cleanup()
  closeTestDatabases()
  vi.restoreAllMocks()
})

describe('the day axis', () => {
  it('is one control reading the current range in words', async () => {
    const { days } = await showFilter([
      { at: '2026-03-09T10:00:00', body: 'Monday' },
    ])

    expect(days().textContent).toContain(
      formatDayRange('2026-03-09', '2026-03-09'),
    )
  })

  it('leaves no native picker in the header', async () => {
    await showFilter([{ at: '2026-03-09T10:00:00', body: 'Monday' }])

    const header = screen.getByRole('banner')
    expect(header.querySelector('select')).toBeNull()
    expect(header.querySelector('input[type="date"]')).toBeNull()
  })

  it('moves the Filter to the range picked on its calendar', async () => {
    const user = userEvent.setup()
    const { days } = await showFilter([
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
    const { days } = await showFilter([
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
    const { days, project } = await showFilter([
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
    const { project, desktop, core, notes } = await showFilter([
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
    const { desktop } = await showFilter([
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
    await showFilter([{ at: '2026-03-09T10:00:00', body: 'Monday' }])

    await user.type(within(header()).getByLabelText('Search'), 'Mon')

    await vi.waitFor(() => {
      expect(screen.queryByRole('button', { name: /copy digest/i })).toBeNull()
    })
  })
})

describe('every filter control', () => {
  it('says what it is to a screen reader', async () => {
    await showFilter([{ at: '2026-03-09T10:00:00', body: 'Monday' }])

    // Each says what it is — and the two that hold a value say that too,
    // rather than letting a label swallow it.
    expect(
      within(header()).getByRole('button', {
        name: `Days ${formatDayRange('2026-03-09', '2026-03-09')}`,
      }),
    ).toBeTruthy()
    expect(
      within(header()).getByRole('combobox', { name: 'Project Any Project' }),
    ).toBeTruthy()
    expect(within(header()).getByLabelText('Search')).toBeTruthy()
  })
})

describe('Escape', () => {
  it('clears a Search before it closes the window', async () => {
    const user = userEvent.setup()
    const { desktop } = await showFilter([
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
    const { desktop, days } = await showFilter([
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

/** History as this file reads it: opened, with the header's two controls. */
async function showFilter(captured: Array<{ at: string; body: string }>) {
  const opened = await showHistory(captured)

  return {
    ...opened,
    // Found by what a screen reader hears: the name of the control, and then
    // what it is currently set to. Scoped to the header, because a Note row
    // has a Project of its own and this file is about the Filter.
    days: () => within(header()).getByRole('button', { name: /^Days/ }),
    project: () => within(header()).getByRole('combobox', { name: /^Project/ }),
  }
}

/** The Filter's header, which is the whole of what this file is about. */
function header(): HTMLElement {
  return screen.getByRole('banner')
}
