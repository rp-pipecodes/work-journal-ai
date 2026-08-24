// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { fakeDesktop, type FakeDesktop } from '@/platform/testing/desktop'
import { createJournal, type Journal } from '@/journal/journal'
import { fixedClock, openTestDatabase } from '@/journal/testing/database'
import CaptureView from './CaptureView'

// The Capture as the user meets it. What Enter and Escape mean, what a refusal
// leaves on screen, and how big the window has to be to hold it are all decided
// here, so this is where they have to be pressed.

afterEach(cleanup)

/** A journal on a real schema, so Predictions come from real Projects. */
async function openJournal(bodies: string[] = []): Promise<Journal> {
  const { driver } = await openTestDatabase()
  const journal = createJournal({
    clock: fixedClock('2026-03-02T09:00:00Z'),
    driver,
  })
  for (const body of bodies) await journal.capture(body)
  return journal
}

/** A journal that cannot store anything — every Capture is refused. */
function refusingJournal(journal: Journal): Journal {
  return {
    ...journal,
    capture: () => Promise.reject(new Error('the disk is gone')),
  }
}

function showCapture(desktop: FakeDesktop, journal: Journal) {
  render(<CaptureView desktop={desktop} journal={Promise.resolve(journal)} />)
}

function field(): HTMLInputElement {
  return screen.getByLabelText('What did you just do?') as HTMLInputElement
}

function type(text: string) {
  fireEvent.change(field(), { target: { value: text } })
}

/** What a screen reader would make of a node: what is hidden from it, gone. */
function reading(node: Element | null): string {
  if (node === null) return ''
  const copy = node.cloneNode(true) as Element
  for (const hidden of copy.querySelectorAll('[aria-hidden="true"]')) {
    hidden.remove()
  }
  return (copy.textContent ?? '').replace(/\s+/g, ' ').trim()
}

function pressEnter() {
  fireEvent.keyDown(field(), { key: 'Enter' })
}

describe('a refused Capture', () => {
  it('grows the window rather than taking the room from the field', async () => {
    const desktop = fakeDesktop()
    showCapture(desktop, refusingJournal(await openJournal()))

    type('shipped the importer')
    pressEnter()

    await screen.findByRole('alert')
    expect(desktop.fits.at(-1)).toEqual({ predictions: 0, refused: true })
    // The Body is still there, and still the user's to fix and retry.
    expect(field().value).toBe('shipped the importer')
  })

  it('announces a second refusal as a second message', async () => {
    const desktop = fakeDesktop()
    showCapture(desktop, refusingJournal(await openJournal()))

    type('shipped the importer')
    pressEnter()
    const first = await screen.findByRole('alert')

    pressEnter()
    // A node that survived would read to a screen reader as the same message
    // still sitting there, so the retry would pass in silence.
    await expect.poll(() => screen.getByRole('alert') !== first).toBe(true)
  })

  it('leaves the window at rest again when the next Capture begins', async () => {
    const desktop = fakeDesktop()
    showCapture(desktop, refusingJournal(await openJournal()))

    type('shipped the importer')
    pressEnter()
    await screen.findByRole('alert')

    desktop.beginCapture()

    await expect.poll(() => screen.queryByRole('alert')).toBeNull()
    expect(field().value).toBe('')
    expect(desktop.fits.at(-1)).toEqual({ predictions: 0, refused: false })
  })
})

describe('the Predictions', () => {
  it('grow the window by the rows they take', async () => {
    const desktop = fakeDesktop()
    showCapture(desktop, await openJournal(['#habit a note', '#hall a note']))

    type('#ha')

    await screen.findAllByRole('option')
    await expect
      .poll(() => desktop.fits.at(-1))
      .toEqual({ predictions: 2, refused: false })
  })

  it('commit on mouse-down, because a click blurs the field first', async () => {
    const desktop = fakeDesktop()
    showCapture(desktop, await openJournal(['#habit a note']))

    type('#ha')
    const option = await screen.findByRole('option')

    // A click would blur the field, and the blur handler discards the Capture:
    // the choice has to land before the mouse button comes back up.
    fireEvent.mouseDown(option.firstElementChild!)

    await expect.poll(() => field().value).toBe('#habit ')
  })

  it('keep the field and the list announced to a screen reader', async () => {
    const desktop = fakeDesktop()
    showCapture(desktop, await openJournal(['#habit a note']))

    type('#ha')
    const option = await screen.findByRole('option')

    expect(field().getAttribute('aria-autocomplete')).toBe('list')
    expect(field().getAttribute('aria-expanded')).toBe('true')
    expect(field().getAttribute('aria-controls')).toBe(
      option.closest('[role="listbox"]')?.id,
    )
    expect(option.getAttribute('aria-selected')).toBe('true')
  })
})

describe('the keyboard bargain', () => {
  it('is spelled out beside the field', async () => {
    const desktop = fakeDesktop()
    showCapture(desktop, await openJournal())

    // The hints are described to the field rather than only drawn next to it,
    // so the bargain reaches a reader who never sees them.
    const described = field().getAttribute('aria-describedby')?.split(' ') ?? []
    const hints = described
      .map((id) => reading(document.getElementById(id)))
      .join(' ')

    // A whole sentence each, rather than a glyph and a verb: "↵ commits" is
    // not something to read aloud.
    expect(hints).toMatch(/Return commits\./)
    expect(hints).toMatch(/Escape abandons\./)
  })
})
