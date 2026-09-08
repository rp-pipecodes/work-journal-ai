import { expect, it } from 'vitest'
import { releaseNotes } from './release-notes'

it('reads a changelog section as the sentences it is made of', () => {
  const body = [
    '- Copies are named by what they contain.',
    '- The tray shows today’s Captured Note count.',
  ].join('\n')

  expect(releaseNotes(body)).toEqual([
    'Copies are named by what they contain.',
    'The tray shows today’s Captured Note count.',
  ])
})

it('drops the blank lines and any heading the section came with', () => {
  const body = '\n## 0.12.0 — 2026-09-08\n\n- One thing changed.\n\n'

  expect(releaseNotes(body)).toEqual(['One thing changed.'])
})

// Every release published before the manifest carried the changelog, which is
// every release an installed copy could be updating from today.
it('says nothing when the release said nothing', () => {
  expect(releaseNotes(undefined)).toEqual([])
  expect(releaseNotes('   \n\n')).toEqual([])
})
