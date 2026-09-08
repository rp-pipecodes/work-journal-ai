import { expect, it } from 'vitest'
import { CHANGELOG, changelogVersions } from './changelog'

const FILE = `# Changelog

How this file works, addressed to whoever edits it.

## Unreleased

- Something that has not been released.

## 0.12.0 — 2026-09-08

- Settings shows what a release changed.
- The README is the page a user reads.

## 0.11.1 — 2026-09-07

- Copies are named by what they contain.
`

it('reads the file as its released versions, newest first', () => {
  expect(changelogVersions(FILE)).toEqual([
    {
      version: '0.12.0',
      date: '2026-09-08',
      notes: [
        'Settings shows what a release changed.',
        'The README is the page a user reads.',
      ],
    },
    {
      version: '0.11.1',
      date: '2026-09-07',
      notes: ['Copies are named by what they contain.'],
    },
  ])
})

// The heading is a promise about the next release, not a record of one, and a
// build that shipped it would be saying it already has what it does not.
it('leaves out the section the next release is being written into', () => {
  expect(changelogVersions(FILE).map((entry) => entry.version)).not.toContain(
    'Unreleased',
  )
})

it('ships with the file this repository keeps', () => {
  // Not a fixture: the build reads the real changelog, and a build that read
  // nothing would show an empty list rather than fail.
  expect(CHANGELOG.length).toBeGreaterThan(0)
  expect(CHANGELOG[0].notes.length).toBeGreaterThan(0)
})
