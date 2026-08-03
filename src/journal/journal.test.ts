import { afterEach, describe, expect, it } from 'vitest'
import {
  createJournal,
  decideArrival,
  decideKeystroke,
  describeCopiedDigest,
  filterForJournalDay,
  filterForPreset,
  filterForRange,
  formatJournalDay,
  formatTimeOfDay,
  exportFileName,
  groupByJournalDay,
  journalDayFor,
  type Journal,
} from './journal'
import { fixedClock, migrationSql, openTestDatabase } from './testing/database'

// Every test drives the core through its public operations and asserts on what
// comes back out. Nothing here asserts that a particular query ran.

const openJournals: Array<() => void> = []

afterEach(() => {
  for (const close of openJournals.splice(0)) {
    close()
  }
})

async function journalAt(instant: string) {
  const { driver, close } = await openTestDatabase()
  openJournals.push(close)
  const clock = fixedClock(instant)
  return { journal: createJournal({ clock, driver }), clock }
}

/**
 * What one day holds, for tests that want to see what a Capture stored rather
 * than to exercise a read. A single day is a Filter whose ends are equal, so
 * this is `notesForFilter` and nothing more: newest first, like the list.
 */
function notesOn(journal: Journal, journalDay: string) {
  return journal.notesForFilter(filterForJournalDay(journalDay))
}

describe('journalDayFor', () => {
  it('is the local calendar day of the instant', () => {
    expect(journalDayFor(local('2026-03-12T00:45:00'))).toBe('2026-03-12')
    expect(journalDayFor(local('2026-03-12T09:30:00'))).toBe('2026-03-12')
    expect(journalDayFor(local('2026-03-12T23:59:59'))).toBe('2026-03-12')
  })

  it('puts either side of midnight on different days', () => {
    expect(journalDayFor(local('2026-03-11T23:59:59'))).toBe('2026-03-11')
    expect(journalDayFor(local('2026-03-12T00:00:00'))).toBe('2026-03-12')
  })

  it('resolves a day spanning a DST transition to exactly one day', () => {
    // Europe/Lisbon springs forward at 01:00 on 2026-03-29 — see vite.config.ts
    // for why the suite pins the timezone.
    const acrossTheTransition = [
      '2026-03-29T00:00:00',
      '2026-03-29T12:00:00',
      '2026-03-29T23:59:59',
    ].map((wallClock) => journalDayFor(local(wallClock)))

    expect(new Set(acrossTheTransition)).toEqual(new Set(['2026-03-29']))
  })
})

describe('decideKeystroke', () => {
  it('commits on Enter with text', () => {
    expect(decideKeystroke('Enter', 'shipped the tray menu')).toBe('commit')
  })

  it('ignores Enter on empty or whitespace-only text', () => {
    expect(decideKeystroke('Enter', '')).toBe('ignore')
    expect(decideKeystroke('Enter', '   \t ')).toBe('ignore')
  })

  it('discards on Escape, whatever has been typed', () => {
    expect(decideKeystroke('Escape', 'half a thought')).toBe('discard')
    expect(decideKeystroke('Escape', '')).toBe('discard')
  })

  it('neither commits nor discards on an ordinary key', () => {
    expect(decideKeystroke('a', 'a')).toBe('ignore')
    expect(decideKeystroke('Tab', 'something')).toBe('ignore')
  })
})

describe('capture', () => {
  it('reads a committed Note back with its Body intact', async () => {
    const { journal } = await journalAt('2026-03-12T09:30:00')

    const captured = await journal.capture('rewrote the digest grouping')

    expect(captured?.body).toBe('rewrote the digest grouping')
    const stored = await notesOn(journal, '2026-03-12')
    expect(stored.map((note) => note.body)).toEqual([
      'rewrote the digest grouping',
    ])
  })

  it('trims surrounding whitespace from the Body', async () => {
    const { journal } = await journalAt('2026-03-12T09:30:00')

    const captured = await journal.capture('  paired on the migration  ')

    expect(captured?.body).toBe('paired on the migration')
  })

  it('commits nothing for empty or whitespace-only input', async () => {
    const { journal } = await journalAt('2026-03-12T09:30:00')

    expect(await journal.capture('')).toBeNull()
    expect(await journal.capture('   \t ')).toBeNull()
    expect(await notesOn(journal, '2026-03-12')).toEqual([])
  })

  it('refuses a Body containing a line break', async () => {
    const { journal } = await journalAt('2026-03-12T09:30:00')

    await expect(journal.capture('one line\nand another')).rejects.toThrow(
      /line break/i,
    )
  })

  it('records Captured At as UTC', async () => {
    const { journal } = await journalAt('2026-03-12T09:30:00')

    const captured = await journal.capture('checked the clock')

    // 09:30 in Europe/Lisbon on that date is 09:30 UTC — see vite.config.ts.
    expect(captured?.capturedAt).toBe('2026-03-12T09:30:00.000Z')
  })

  it('files a Note captured after midnight under the local calendar day', async () => {
    const { journal } = await journalAt('2026-03-12T00:45:00')

    const captured = await journal.capture('still debugging the tray')

    expect(captured?.journalDay).toBe('2026-03-12')
    expect((await notesOn(journal, '2026-03-12')).length).toBe(1)
    expect(await notesOn(journal, '2026-03-11')).toEqual([])
  })

  it('gives a fresh Note no Edited At', async () => {
    const { journal } = await journalAt('2026-03-12T09:30:00')

    const captured = await journal.capture('untouched since capture')

    expect(captured?.editedAt).toBeNull()
  })

  it('gives each Note its own identity', async () => {
    const { journal } = await journalAt('2026-03-12T09:30:00')

    const first = await journal.capture('the same words')
    const second = await journal.capture('the same words')

    expect(first?.id).not.toBe(second?.id)
  })
})

describe('editBody', () => {
  it('reads the new Body back from the journal', async () => {
    const { journal } = await journalAt('2026-03-12T09:30:00')
    const captured = await journal.capture('shpped the tray menu')

    await journal.editBody(captured!.id, 'shipped the tray menu')

    const [stored] = await notesOn(journal, '2026-03-12')
    expect(stored.body).toBe('shipped the tray menu')
  })

  it('leaves Captured At untouched and records Edited At', async () => {
    const { journal, clock } = await journalAt('2026-03-12T09:30:00')
    const captured = await journal.capture('a typo goes here')
    clock.set(local('2026-03-12T17:00:00'))

    const edited = await journal.editBody(captured!.id, 'a typo went here')

    expect(edited.capturedAt).toBe(captured!.capturedAt)
    expect(edited.editedAt).toBe('2026-03-12T17:00:00.000Z')
  })

  it('leaves the Journal Day alone, whatever the clock says now', async () => {
    const { journal, clock } = await journalAt('2026-03-12T09:30:00')
    const captured = await journal.capture('filed under thursday')
    clock.set(local('2026-03-16T09:00:00'))

    const edited = await journal.editBody(captured!.id, 'still under thursday')

    expect(edited.journalDay).toBe('2026-03-12')
  })

  it('trims surrounding whitespace from the new Body', async () => {
    const { journal } = await journalAt('2026-03-12T09:30:00')
    const captured = await journal.capture('untrimmed')

    const edited = await journal.editBody(captured!.id, '  trimmed  ')

    expect(edited.body).toBe('trimmed')
  })

  it('refuses to empty a Body', async () => {
    const { journal } = await journalAt('2026-03-12T09:30:00')
    const captured = await journal.capture('something worth keeping')

    await expect(journal.editBody(captured!.id, '   ')).rejects.toThrow(
      /empty/i,
    )
    const [stored] = await notesOn(journal, '2026-03-12')
    expect(stored.body).toBe('something worth keeping')
  })

  it('refuses a Body containing a line break', async () => {
    const { journal } = await journalAt('2026-03-12T09:30:00')
    const captured = await journal.capture('one line')

    await expect(
      journal.editBody(captured!.id, 'one line\nand another'),
    ).rejects.toThrow(/line break/i)
  })

  it('does not mark a Note edited when the Body has not changed', async () => {
    const { journal, clock } = await journalAt('2026-03-12T09:30:00')
    const captured = await journal.capture('the very same words')
    clock.set(local('2026-03-12T17:00:00'))

    const edited = await journal.editBody(captured!.id, 'the very same words')

    expect(edited.editedAt).toBeNull()
  })

  it('refuses to edit a Note that is not there', async () => {
    const { journal } = await journalAt('2026-03-12T09:30:00')

    await expect(journal.editBody('nobody', 'anything')).rejects.toThrow(
      /no such note/i,
    )
  })
})

describe('refile', () => {
  it('moves the Note between Filters and keeps Captured At', async () => {
    const { journal, clock } = await journalAt('2026-03-12T09:30:00')
    const captured = await journal.capture('meant for wednesday')
    clock.set(local('2026-03-12T17:00:00'))

    const refiled = await journal.refile(captured!.id, '2026-03-11')

    expect(refiled.journalDay).toBe('2026-03-11')
    expect(refiled.capturedAt).toBe(captured!.capturedAt)
    expect(refiled.editedAt).toBe('2026-03-12T17:00:00.000Z')
    const thursday = { from: '2026-03-12', to: '2026-03-12' }
    const wednesday = { from: '2026-03-11', to: '2026-03-11' }
    expect(await journal.notesForFilter(thursday)).toEqual([])
    expect(
      (await journal.notesForFilter(wednesday)).map((note) => note.body),
    ).toEqual(['meant for wednesday'])
  })

  it('leaves the Body alone', async () => {
    const { journal } = await journalAt('2026-03-12T09:30:00')
    const captured = await journal.capture('the same remark, another day')

    const refiled = await journal.refile(captured!.id, '2026-03-11')

    expect(refiled.body).toBe('the same remark, another day')
  })

  it('does not mark a Note edited when the Journal Day has not changed', async () => {
    const { journal, clock } = await journalAt('2026-03-12T09:30:00')
    const captured = await journal.capture('already where it belongs')
    clock.set(local('2026-03-12T17:00:00'))

    const refiled = await journal.refile(captured!.id, '2026-03-12')

    expect(refiled.editedAt).toBeNull()
  })

  it('refuses a Journal Day that is not a day', async () => {
    const { journal } = await journalAt('2026-03-12T09:30:00')
    const captured = await journal.capture('somewhere')

    await expect(journal.refile(captured!.id, '12/03/2026')).rejects.toThrow(
      /journal day/i,
    )
  })

  it('refuses a year the journal cannot have been written in', async () => {
    const { journal } = await journalAt('2026-03-12T09:30:00')
    const captured = await journal.capture('still where it was')

    // What a date input emits while a year is being typed: `2026` arrives as
    // `0002`, `0020`, `0202` first, each of them a shaped, valid-looking day.
    await expect(journal.refile(captured!.id, '0002-03-12')).rejects.toThrow(
      /journal day/i,
    )

    const march = { from: '2026-03-12', to: '2026-03-12' }
    expect((await journal.notesForFilter(march)).map((note) => note.body)).toEqual([
      'still where it was',
    ])
  })

  it('refuses to refile a Note that is not there', async () => {
    const { journal } = await journalAt('2026-03-12T09:30:00')

    await expect(journal.refile('nobody', '2026-03-11')).rejects.toThrow(
      /no such note/i,
    )
  })
})

describe('delete', () => {
  it('leaves no trace in any Filter, nor in what a Digest reads', async () => {
    const { journal, clock } = await journalAt('2026-03-12T09:30:00')
    const doomed = await journal.capture('said in error')
    clock.set(local('2026-03-12T11:00:00'))
    await journal.capture('said in earnest')

    await journal.delete(doomed!.id)

    const everything = { from: '0000-01-01', to: '9999-12-31' }
    expect(
      (await journal.notesForFilter(everything)).map((note) => note.body),
    ).toEqual(['said in earnest'])
    expect(
      (await notesOn(journal, '2026-03-12')).map((note) => note.body),
    ).toEqual(['said in earnest'])
  })

  it('has nowhere to leave a soft-deleted row: the schema has no such column', () => {
    // The other half of "genuinely gone": a Note cannot be hidden rather than
    // removed, because there is nothing in the schema to hide it with.
    expect(migrationSql().join('\n')).not.toMatch(/deleted/i)
  })

  it('stops being the most recent Occupied Day once its day is empty', async () => {
    const { journal, clock } = await journalAt('2026-03-11T09:00:00')
    await journal.capture('wednesday')
    clock.set(local('2026-03-13T09:00:00'))
    const friday = await journal.capture('friday')

    await journal.delete(friday!.id)

    expect(await journal.defaultFilter()).toEqual({
      from: '2026-03-11',
      to: '2026-03-11',
    })
  })

  it('refuses to delete a Note that is not there', async () => {
    const { journal } = await journalAt('2026-03-12T09:30:00')

    await expect(journal.delete('nobody')).rejects.toThrow(/no such note/i)
  })
})

describe('groupByJournalDay', () => {
  it('gathers Notes under their day, keeping the order they arrive in', async () => {
    const { journal, clock } = await journalAt('2026-03-11T09:00:00')

    await journal.capture('wednesday morning')
    clock.set(local('2026-03-11T15:00:00'))
    await journal.capture('wednesday afternoon')
    clock.set(local('2026-03-13T09:00:00'))
    await journal.capture('friday')

    const groups = groupByJournalDay(
      await journal.notesForFilter({ from: '2026-03-11', to: '2026-03-13' }),
    )

    expect(
      groups.map((group) => [
        group.journalDay,
        group.notes.map((note) => note.body),
      ]),
    ).toEqual([
      ['2026-03-13', ['friday']],
      ['2026-03-11', ['wednesday afternoon', 'wednesday morning']],
    ])
  })

  it('groups nothing into nothing', () => {
    expect(groupByJournalDay([])).toEqual([])
  })
})

// Both on-screen formatters follow the reader's locale, so these tests say
// which day and which time is shown rather than which words it is shown in.
// The one format that must not move is the Digest heading, pinned in the
// Digest tests.
describe('formatJournalDay', () => {
  it('reads a Journal Day as the day it names, not the day it parses as', () => {
    // 'YYYY-MM-DD' parses as UTC midnight, which is the previous evening in
    // half the world's timezones; the heading must still say the 13th.
    const heading = formatJournalDay('2026-03-13')

    expect(heading).toContain('13')
    expect(heading).not.toContain('12')
  })
})

describe('formatTimeOfDay', () => {
  it('reads Captured At as a local time of day', () => {
    // 09:05 UTC is 09:05 in Europe/Lisbon on that date — see vite.config.ts.
    // Written 09:05 or 09:05 AM depending on the reader's locale.
    expect(formatTimeOfDay('2026-03-13T09:05:00.000Z')).toMatch(/\b09.05\b/)
  })
})

describe('defaultFilter', () => {
  it('opens on the most recent Occupied Day', async () => {
    const { journal, clock } = await journalAt('2026-03-11T09:00:00')

    await journal.capture('wednesday')
    clock.set(local('2026-03-13T09:00:00'))
    await journal.capture('friday')

    expect(await journal.defaultFilter()).toEqual({
      from: '2026-03-13',
      to: '2026-03-13',
    })
  })

  it('skips unoccupied days entirely: a Monday resolves to the previous Friday', async () => {
    const { journal, clock } = await journalAt('2026-03-13T17:00:00')

    await journal.capture('friday, before the weekend')
    // The weekend is empty, and it is now Monday morning.
    clock.set(local('2026-03-16T09:00:00'))

    expect(await journal.defaultFilter()).toEqual({
      from: '2026-03-13',
      to: '2026-03-13',
    })
  })

  it('reaches back however long the gap', async () => {
    const { journal, clock } = await journalAt('2026-02-27T17:00:00')

    await journal.capture('last day before leave')
    clock.set(local('2026-03-16T09:00:00'))

    expect(await journal.defaultFilter()).toEqual({
      from: '2026-02-27',
      to: '2026-02-27',
    })
  })

  it('resolves to nothing on an empty database rather than an arbitrary date', async () => {
    const { journal } = await journalAt('2026-03-16T09:00:00')

    expect(await journal.defaultFilter()).toBeNull()
  })
})

describe('notesForFilter', () => {
  it('returns the newest Note first', async () => {
    const { journal, clock } = await journalAt('2026-03-13T09:00:00')

    await journal.capture('first')
    clock.set(local('2026-03-13T11:00:00'))
    await journal.capture('second')

    const notes = await journal.notesForFilter({
      from: '2026-03-13',
      to: '2026-03-13',
    })

    expect(notes.map((note) => note.body)).toEqual(['second', 'first'])
  })

  it('orders a Filter spanning several days by Journal Day, newest first', async () => {
    const { journal, clock } = await journalAt('2026-03-11T09:00:00')

    await journal.capture('wednesday')
    clock.set(local('2026-03-13T09:00:00'))
    await journal.capture('friday')

    const notes = await journal.notesForFilter({
      from: '2026-03-11',
      to: '2026-03-13',
    })

    expect(notes.map((note) => note.body)).toEqual(['friday', 'wednesday'])
  })

  it('returns nothing for a Filter no Note falls under', async () => {
    const { journal } = await journalAt('2026-03-13T09:00:00')

    await journal.capture('friday')

    expect(
      await journal.notesForFilter({ from: '2026-03-14', to: '2026-03-15' }),
    ).toEqual([])
  })

  it('includes both ends of a range and excludes the days either side', async () => {
    const { journal, clock } = await journalAt('2026-03-09T09:00:00')

    for (const day of ['09', '10', '11', '12', '13']) {
      clock.set(local(`2026-03-${day}T09:00:00`))
      await journal.capture(`the ${day}th`)
    }

    const notes = await journal.notesForFilter({
      from: '2026-03-10',
      to: '2026-03-12',
    })

    expect(notes.map((note) => note.body)).toEqual([
      'the 12th',
      'the 11th',
      'the 10th',
    ])
  })

  it('returns a single day when both ends of the range are the same', async () => {
    const { journal, clock } = await journalAt('2026-03-11T09:00:00')

    await journal.capture('wednesday')
    clock.set(local('2026-03-12T09:00:00'))
    await journal.capture('thursday')

    const notes = await journal.notesForFilter({
      from: '2026-03-11',
      to: '2026-03-11',
    })

    expect(notes.map((note) => note.body)).toEqual(['wednesday'])
  })
})

describe('notesMatching', () => {
  it('finds a Note whose Body contains the term, whatever the case', async () => {
    const { journal } = await journalAt('2026-03-13T09:00:00')

    await journal.capture('the MIGRATION went wrong')

    expect(
      (await journal.notesMatching('migration')).map((note) => note.body),
    ).toEqual(['the MIGRATION went wrong'])
  })

  it('reads the whole journal, newest first, whatever days the matches are on', async () => {
    const { journal, clock } = await journalAt('2026-03-09T09:00:00')

    await journal.capture('planned the migration')
    clock.set(local('2026-03-11T09:00:00'))
    await journal.capture('nothing to do with it')
    clock.set(local('2026-03-13T09:00:00'))
    await journal.capture('ran the migration')

    expect(
      (await journal.notesMatching('migration')).map((note) => note.body),
    ).toEqual(['ran the migration', 'planned the migration'])
  })

  it('returns nothing when no Body contains the term', async () => {
    const { journal } = await journalAt('2026-03-13T09:00:00')

    await journal.capture('shipped the tray menu')

    expect(await journal.notesMatching('migration')).toEqual([])
  })

  it('matches a term in the middle of a word, as a substring does', async () => {
    const { journal } = await journalAt('2026-03-13T09:00:00')

    await journal.capture('rewrote the digest grouping')

    expect(
      (await journal.notesMatching('grat')).map((note) => note.body),
    ).toEqual([])
    expect(
      (await journal.notesMatching('roup')).map((note) => note.body),
    ).toEqual(['rewrote the digest grouping'])
  })

  it('reads a wildcard as the character it is, not as a pattern', async () => {
    const { journal, clock } = await journalAt('2026-03-13T09:00:00')

    await journal.capture('cut the queue by 50%')
    clock.set(local('2026-03-13T11:00:00'))
    await journal.capture('nothing to do with it')

    expect(
      (await journal.notesMatching('50%')).map((note) => note.body),
    ).toEqual(['cut the queue by 50%'])
    // A bare wildcard would otherwise match every Note in the journal.
    expect((await journal.notesMatching('%')).map((note) => note.body)).toEqual(
      ['cut the queue by 50%'],
    )
  })
})

describe('digest', () => {
  it('renders one bullet per Note, oldest first and without timestamps', async () => {
    const { journal, clock } = await journalAt('2026-03-13T09:00:00')

    await journal.capture('first')
    clock.set(local('2026-03-13T11:00:00'))
    await journal.capture('second')

    const digest = await journal.digest({
      from: '2026-03-13',
      to: '2026-03-13',
    })

    expect(digest.markdown).toBe('- first\n- second')
  })

  it('reads in the reverse order of the list on screen', async () => {
    const { journal, clock } = await journalAt('2026-03-11T09:00:00')

    await journal.capture('wednesday')
    clock.set(local('2026-03-13T09:00:00'))
    await journal.capture('friday')

    const filter = { from: '2026-03-11', to: '2026-03-13' }
    const onScreen = await journal.notesForFilter(filter)
    const digest = await journal.digest(filter)

    expect(onScreen.map((note) => note.body)).toEqual(['friday', 'wednesday'])
    expect(digest.markdown.indexOf('wednesday')).toBeLessThan(
      digest.markdown.indexOf('friday'),
    )
  })

  it('gives a single-day Filter no heading at all', async () => {
    const { journal } = await journalAt('2026-03-13T09:00:00')

    await journal.capture('took the on-call handover')

    const digest = await journal.digest({
      from: '2026-03-13',
      to: '2026-03-13',
    })

    expect(digest.markdown).toBe('- took the on-call handover')
  })

  it('heads each Occupied Day of a multi-day Filter, and no empty day', async () => {
    const { journal, clock } = await journalAt('2026-03-11T09:00:00')

    await journal.capture('the migration landed')
    clock.set(local('2026-03-11T15:00:00'))
    await journal.capture('pairing with Ana')
    // Nothing on the 12th: an empty day produces no heading.
    clock.set(local('2026-03-13T09:00:00'))
    await journal.capture('took the on-call handover')

    const digest = await journal.digest({
      from: '2026-03-11',
      to: '2026-03-13',
    })

    expect(digest.markdown).toBe(
      [
        '## Wed 11 Mar',
        '- the migration landed',
        '- pairing with Ana',
        '',
        '## Fri 13 Mar',
        '- took the on-call handover',
      ].join('\n'),
    )
  })

  it('heads the one Occupied Day of a multi-day Filter', async () => {
    const { journal } = await journalAt('2026-03-13T09:00:00')

    await journal.capture('the only day with anything on it')

    const digest = await journal.digest({
      from: '2026-03-09',
      to: '2026-03-13',
    })

    expect(digest.markdown).toBe(
      '## Fri 13 Mar\n- the only day with anything on it',
    )
  })

  it('counts exactly as many Notes as it renders bullets', async () => {
    const { journal, clock } = await journalAt('2026-03-11T09:00:00')

    for (const day of ['11', '12', '13']) {
      clock.set(local(`2026-03-${day}T09:00:00`))
      await journal.capture(`the ${day}th`)
      await journal.capture(`the ${day}th again`)
    }

    const digest = await journal.digest({
      from: '2026-03-11',
      to: '2026-03-13',
    })

    const bullets = digest.markdown
      .split('\n')
      .filter((line) => line.startsWith('- '))

    expect(digest.noteCount).toBe(6)
    expect(bullets).toHaveLength(digest.noteCount)
  })

  it('renders nothing at all for a Filter no Note falls under', async () => {
    const { journal } = await journalAt('2026-03-13T09:00:00')

    await journal.capture('friday')

    const digest = await journal.digest({
      from: '2026-03-14',
      to: '2026-03-15',
    })

    expect(digest).toEqual({ markdown: '', noteCount: 0 })
  })
})

describe('exportAll', () => {
  it('includes every Note in the database exactly once', async () => {
    const { journal, clock } = await journalAt('2026-03-11T09:00:00')
    const bodies = []
    for (const day of ['09', '11', '12', '16']) {
      for (const hour of ['09', '15']) {
        clock.set(local(`2026-03-${day}T${hour}:00:00`))
        bodies.push(`the ${day}th at ${hour}`)
        await journal.capture(`the ${day}th at ${hour}`)
      }
    }

    const exported = await journal.exportAll()

    const bullets = exported.markdown
      .split('\n')
      .filter((line) => line.startsWith('- '))
    expect(exported.noteCount).toBe(bodies.length)
    expect(bullets).toHaveLength(bodies.length)
    for (const body of bodies) {
      expect(bullets.filter((bullet) => bullet === `- ${body}`)).toHaveLength(1)
    }
  })

  it('reaches Notes no Filter the reader has opened would show', async () => {
    const { journal, clock } = await journalAt('2024-01-02T09:00:00')
    await journal.capture('two years ago')
    clock.set(local('2026-03-13T09:00:00'))
    await journal.capture('today')

    const exported = await journal.exportAll()

    expect(exported.markdown).toContain('- two years ago')
    expect(exported.markdown).toContain('- today')
    expect(exported.noteCount).toBe(2)
  })

  it('reads oldest first, under a heading for every day', async () => {
    const { journal, clock } = await journalAt('2026-03-11T09:00:00')
    await journal.capture('the migration landed')
    clock.set(local('2026-03-13T09:00:00'))
    await journal.capture('took the on-call handover')

    const exported = await journal.exportAll()

    expect(exported.markdown).toBe(
      [
        '## Wed 11 Mar',
        '- the migration landed',
        '',
        '## Fri 13 Mar',
        '- took the on-call handover',
      ].join('\n'),
    )
  })

  it('heads the single day of a journal holding only one', async () => {
    const { journal } = await journalAt('2026-03-13T09:00:00')
    await journal.capture('the only day with anything on it')

    const exported = await journal.exportAll()

    expect(exported.markdown).toBe(
      '## Fri 13 Mar\n- the only day with anything on it',
    )
  })

  it('renders nothing at all for a journal with no Notes', async () => {
    const { journal } = await journalAt('2026-03-13T09:00:00')

    expect(await journal.exportAll()).toEqual({ markdown: '', noteCount: 0 })
  })
})

describe('exportFileName', () => {
  it('names the file after the journal and the day it was taken', () => {
    expect(exportFileName(local('2026-03-09T21:15:00'))).toBe(
      'work-journal-2026-03-09.md',
    )
  })

  it('is a plain file name, with nowhere to traverse to', () => {
    expect(exportFileName(local('2026-03-09T21:15:00'))).not.toMatch(/[/\\]/)
  })
})

describe('describeCopiedDigest', () => {
  it('reports as many Notes as the Digest has bullets', async () => {
    const { journal, clock } = await journalAt('2026-03-11T09:00:00')

    await journal.capture('the migration landed')
    clock.set(local('2026-03-13T09:00:00'))
    await journal.capture('took the on-call handover')

    const digest = await journal.digest({
      from: '2026-03-11',
      to: '2026-03-13',
    })
    const bullets = digest.markdown
      .split('\n')
      .filter((line) => line.startsWith('- '))

    expect(describeCopiedDigest(digest)).toBe(`Copied ${bullets.length} Notes.`)
  })

  it('says Note rather than Notes for a single one', () => {
    expect(describeCopiedDigest({ markdown: '- alone', noteCount: 1 })).toBe(
      'Copied 1 Note.',
    )
  })

  it('claims no copy at all when the Filter held nothing', () => {
    expect(describeCopiedDigest({ markdown: '', noteCount: 0 })).toBe(
      'No Notes to copy.',
    )
  })
})

describe('filterForRange', () => {
  it('reads a range oldest-end first', () => {
    expect(filterForRange('2026-03-09', '2026-03-13')).toEqual({
      from: '2026-03-09',
      to: '2026-03-13',
    })
  })

  it('orders the ends whichever way round they were picked', () => {
    expect(filterForRange('2026-03-13', '2026-03-09')).toEqual({
      from: '2026-03-09',
      to: '2026-03-13',
    })
  })

  it('makes a single day out of two equal ends', () => {
    expect(filterForRange('2026-03-13', '2026-03-13')).toEqual({
      from: '2026-03-13',
      to: '2026-03-13',
    })
  })
})

describe('filterForJournalDay', () => {
  it('reads one day as a range whose ends are equal', () => {
    expect(filterForJournalDay('2026-03-13')).toEqual({
      from: '2026-03-13',
      to: '2026-03-13',
    })
  })
})

describe('filterForPreset', () => {
  // Anchors are civil calendar days. 2026-08-05 is a Wednesday.
  const wednesday = '2026-08-05'

  it('today is the day itself', () => {
    expect(filterForPreset('today', wednesday)).toEqual({
      from: '2026-08-05',
      to: '2026-08-05',
    })
  })

  it('yesterday is the calendar day before today', () => {
    expect(filterForPreset('yesterday', wednesday)).toEqual({
      from: '2026-08-04',
      to: '2026-08-04',
    })
  })

  it('yesterday crosses a month boundary', () => {
    expect(filterForPreset('yesterday', '2026-08-01')).toEqual({
      from: '2026-07-31',
      to: '2026-07-31',
    })
  })

  it('this week runs Monday through today', () => {
    expect(filterForPreset('this-week', wednesday)).toEqual({
      from: '2026-08-03',
      to: '2026-08-05',
    })
  })

  it('this week on a Monday is just today', () => {
    expect(filterForPreset('this-week', '2026-08-03')).toEqual({
      from: '2026-08-03',
      to: '2026-08-03',
    })
  })

  it('this week on a Sunday still starts the prior Monday', () => {
    // 2026-08-09 is a Sunday; the week began 2026-08-03.
    expect(filterForPreset('this-week', '2026-08-09')).toEqual({
      from: '2026-08-03',
      to: '2026-08-09',
    })
  })

  it('last week is the full prior Monday–Sunday', () => {
    expect(filterForPreset('last-week', wednesday)).toEqual({
      from: '2026-07-27',
      to: '2026-08-02',
    })
  })

  it('last week from a Monday is the week that just ended', () => {
    expect(filterForPreset('last-week', '2026-08-03')).toEqual({
      from: '2026-07-27',
      to: '2026-08-02',
    })
  })

  it('this month runs the first of the month through today', () => {
    expect(filterForPreset('this-month', wednesday)).toEqual({
      from: '2026-08-01',
      to: '2026-08-05',
    })
  })

  it('this month on the first is just today', () => {
    expect(filterForPreset('this-month', '2026-08-01')).toEqual({
      from: '2026-08-01',
      to: '2026-08-01',
    })
  })

  it('last month is the full prior calendar month', () => {
    expect(filterForPreset('last-month', wednesday)).toEqual({
      from: '2026-07-01',
      to: '2026-07-31',
    })
  })

  it('last month from January is the prior December', () => {
    expect(filterForPreset('last-month', '2026-01-15')).toEqual({
      from: '2025-12-01',
      to: '2025-12-31',
    })
  })

  it('last month handles February in a non-leap year', () => {
    expect(filterForPreset('last-month', '2026-03-10')).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    })
  })

  it('last month handles February in a leap year', () => {
    expect(filterForPreset('last-month', '2024-03-10')).toEqual({
      from: '2024-02-01',
      to: '2024-02-29',
    })
  })
})

describe('decideArrival', () => {
  const friday = { from: '2026-03-13', to: '2026-03-13' }

  it('shows a Note that falls inside the Filter', () => {
    expect(decideArrival(friday, '2026-03-13')).toEqual({ kind: 'show' })
  })

  it('nudges rather than moving the list when the day is outside the Filter', () => {
    expect(decideArrival(friday, '2026-03-16')).toEqual({
      kind: 'nudge',
      journalDay: '2026-03-16',
    })
    expect(decideArrival(friday, '2026-03-12')).toEqual({
      kind: 'nudge',
      journalDay: '2026-03-12',
    })
  })

  it('counts both ends of a range as inside it', () => {
    const week = { from: '2026-03-09', to: '2026-03-13' }

    expect(decideArrival(week, '2026-03-09')).toEqual({ kind: 'show' })
    expect(decideArrival(week, '2026-03-13')).toEqual({ kind: 'show' })
    expect(decideArrival(week, '2026-03-08')).toEqual({
      kind: 'nudge',
      journalDay: '2026-03-08',
    })
  })
})

/**
 * The instant at which the suite's pinned timezone read this wall-clock time.
 * A date-time literal carrying no offset is parsed as local time, which is the
 * whole point here — these tests are about a local-calendar decision.
 */
function local(wallClock: string): Date {
  return new Date(wallClock)
}
