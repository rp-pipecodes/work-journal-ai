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

it('drops the blank lines the section is spaced out with', () => {
  const body = '\n- One thing changed.\n\n- And another.\n\n'

  expect(releaseNotes(body)).toEqual(['One thing changed.', 'And another.'])
})

// A manifest published before the workflow put the changelog in it, which is
// every release so far.
it('says nothing when the manifest carried no notes', () => {
  expect(releaseNotes(undefined)).toEqual([])
  expect(releaseNotes('   \n\n')).toEqual([])
})
