// @vitest-environment jsdom

import { afterEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ChangelogVersion } from '@/settings/changelog'
import ChangelogSettings from './ChangelogSettings'

afterEach(cleanup)

const VERSIONS: ChangelogVersion[] = [
  {
    version: '0.12.0',
    date: '2026-09-08',
    notes: ['Settings shows what a release changed.'],
  },
  {
    version: '0.11.1',
    date: '2026-09-07',
    notes: ['Copies are named by what they contain.'],
  },
  {
    version: '0.11.0',
    date: '2026-09-07',
    notes: ['First launch walks through Onboarding.'],
  },
]

/** The bullets of one version's entry, in the order they are read. */
function notesOf(version: string): (string | null)[] {
  return [
    ...screen
      .getByRole('region', { name: `Work Journal ${version}` })
      .querySelectorAll('li'),
  ].map((line) => line.textContent)
}

it('shows what the running version changed without being asked', () => {
  render(<ChangelogSettings versions={VERSIONS} running="0.12.0" />)

  expect(notesOf('0.12.0')).toEqual(['Settings shows what a release changed.'])
  // The question this answers is about the app the user has, so the versions
  // behind it wait to be asked for.
  expect(screen.queryByRole('region', { name: 'Work Journal 0.11.1' })).toBe(
    null,
  )
})

it('opens the versions before it, and closes them again', () => {
  render(<ChangelogSettings versions={VERSIONS} running="0.12.0" />)

  const earlier = screen.getByRole('button', { name: 'Earlier versions' })
  expect(earlier.getAttribute('aria-expanded')).toBe('false')

  fireEvent.click(earlier)

  expect(notesOf('0.11.1')).toEqual(['Copies are named by what they contain.'])
  expect(notesOf('0.11.0')).toEqual(['First launch walks through Onboarding.'])
  // Still there: the list grows downwards from the running version rather than
  // replacing it.
  expect(notesOf('0.12.0')).toEqual(['Settings shows what a release changed.'])

  fireEvent.click(
    screen.getByRole('button', { name: 'Hide earlier versions' }),
  )

  expect(screen.queryByRole('region', { name: 'Work Journal 0.11.1' })).toBe(
    null,
  )
})

// A version cut between releases, and the moment before the running version
// has been read at all.
it('opens at the newest release when the running version is not in the file', () => {
  render(<ChangelogSettings versions={VERSIONS} running="" />)

  expect(notesOf('0.12.0')).toEqual(['Settings shows what a release changed.'])
})

it('offers nothing to open when the running version is the oldest entry', () => {
  render(<ChangelogSettings versions={VERSIONS} running="0.11.0" />)

  expect(notesOf('0.11.0')).toEqual(['First launch walks through Onboarding.'])
  expect(screen.queryByRole('button', { name: /versions/ })).toBe(null)
})
