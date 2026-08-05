import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createHistorySession,
  SEARCH_DEBOUNCE_MS,
  type HistorySnapshot,
} from './history-session'
import {
  ANY_PROJECT,
  createJournal,
  rangeForDays,
  rangeForJournalDay,
  UNFILED,
  type Filter,
  type Journal,
  type Note,
} from './journal'
import { fixedClock, openTestDatabase } from './testing/database'

// Every test drives a session over a real database through its verbs and
// asserts on the snapshot a view would render. Nothing here renders anything.

/** One day in view under no Project constraint: where History opens. */
function anyProjectOn(journalDay: string): Filter {
  return { ...rangeForJournalDay(journalDay), project: ANY_PROJECT }
}

const openDatabases: Array<() => void> = []

afterEach(() => {
  for (const close of openDatabases.splice(0)) {
    close()
  }
  vi.restoreAllMocks()
})

describe('opening', () => {
  it('opens on the most recent Occupied Day', async () => {
    const { session } = await sessionOver([
      { at: '2026-03-09T10:00:00', body: 'Monday' },
      { at: '2026-03-13T10:00:00', body: 'Friday' },
    ])

    await session.open()

    expect(session.snapshot().filter).toEqual(anyProjectOn('2026-03-13'))
    expect(bodiesOf(session.snapshot())).toEqual(['Friday'])
  })

  it('is empty when there are no Notes at all', async () => {
    const { session } = await sessionOver([])

    await session.open()

    expect(session.snapshot().history).toEqual({ state: 'empty' })
    expect(session.snapshot().filter).toBeNull()
  })

  it('is unreadable rather than forever loading when the journal fails', async () => {
    silenceErrors()
    const { session } = await sessionOver([], {
      journal: (core) => ({
        ...core,
        defaultRange: () => Promise.reject(new Error('no database')),
      }),
    })

    await session.open()

    expect(session.snapshot().history).toEqual({ state: 'unreadable' })
  })

  it('tells the view every time the snapshot changes', async () => {
    const { session, seen } = await sessionOver([
      { at: '2026-03-13T10:00:00', body: 'Friday' },
    ])

    await session.open()

    expect(seen.length).toBeGreaterThan(0)
    expect(seen.at(-1)).toEqual(session.snapshot())
  })
})

describe('moving the Filter', () => {
  it('reads the Notes of the range it was moved to', async () => {
    const { session } = await sessionOver([
      { at: '2026-03-09T10:00:00', body: 'Monday' },
      { at: '2026-03-10T10:00:00', body: 'Tuesday' },
      { at: '2026-03-13T10:00:00', body: 'Friday' },
    ])

    await session.open()
    await session.moveTo(rangeForDays('2026-03-09', '2026-03-10'))

    expect(bodiesOf(session.snapshot())).toEqual(['Tuesday', 'Monday'])
  })

  it('is unreadable rather than showing a stale list when a read fails', async () => {
    silenceErrors()
    const { session } = await sessionOver(
      [{ at: '2026-03-13T10:00:00', body: 'Friday' }],
      {
        journal: (core) => ({
          ...core,
          notesForFilter: (filter) =>
            filter.from === '2026-03-09'
              ? Promise.reject(new Error('no database'))
              : core.notesForFilter(filter),
        }),
      },
    )

    await session.open()
    await session.moveTo(rangeForJournalDay('2026-03-09'))

    expect(session.snapshot().history).toEqual({ state: 'unreadable' })
  })

  it('clears the Nudge and the copy confirmation', async () => {
    const { session } = await sessionOver([
      { at: '2026-03-13T10:00:00', body: 'Friday' },
    ])

    await session.open()
    session.copy()
    await settle()
    await session.noteArrived('2026-03-16')
    expect(session.snapshot().nudgedDay).toBe('2026-03-16')
    expect(session.snapshot().confirmation).not.toBeNull()

    await session.moveTo(rangeForJournalDay('2026-03-16'))

    expect(session.snapshot().nudgedDay).toBeNull()
    expect(session.snapshot().confirmation).toBeNull()
  })

  it('lets only the newest of two overlapping reads reach the view', async () => {
    const slow = gate()
    const { session } = await sessionOver(
      [
        { at: '2026-03-09T10:00:00', body: 'Monday' },
        { at: '2026-03-13T10:00:00', body: 'Friday' },
      ],
      {
        journal: (core) => ({
          ...core,
          async notesForFilter(filter) {
            const notes = await core.notesForFilter(filter)
            await slow.reached(filter.from)
            return notes
          },
        }),
      },
    )

    await session.open()
    slow.hold('2026-03-09')
    slow.hold('2026-03-13')

    // Monday is asked for first and answers last: the reader acted on a Nudge
    // back to Friday while it was still in flight.
    const stale = session.moveTo(rangeForJournalDay('2026-03-09'))
    const fresh = session.moveTo(rangeForJournalDay('2026-03-13'))
    slow.release('2026-03-13')
    await fresh
    slow.release('2026-03-09')
    await stale

    expect(bodiesOf(session.snapshot())).toEqual(['Friday'])
  })
})

describe('narrowing the Filter by Project', () => {
  /** One Friday under two Projects, plus something Unfiled. */
  function friday() {
    return sessionOver([
      { at: '2026-03-13T10:00:00', body: '#api rate limits' },
      { at: '2026-03-13T11:00:00', body: 'read the postmortem' },
      { at: '2026-03-13T12:00:00', body: '#billing invoices' },
    ])
  }

  it('opens on Any, showing the day exactly as it did before', async () => {
    const { session } = await friday()

    await session.open()

    expect(session.snapshot().filter?.project).toEqual(ANY_PROJECT)
    expect(bodiesOf(session.snapshot())).toEqual([
      'invoices',
      'read the postmortem',
      'rate limits',
    ])
  })

  it('offers every Project on a Note, whatever the Filter shows', async () => {
    const { session } = await friday()

    await session.open()

    expect(session.snapshot().projects).toEqual(['api', 'billing'])
  })

  it('shows one Project without moving the days', async () => {
    const { session } = await friday()

    await session.open()
    await session.narrowTo({ kind: 'named', name: 'api' })

    expect(bodiesOf(session.snapshot())).toEqual(['rate limits'])
    expect(session.snapshot().filter).toEqual({
      from: '2026-03-13',
      to: '2026-03-13',
      project: { kind: 'named', name: 'api' },
    })
  })

  it('shows only Unfiled Notes under Unfiled', async () => {
    const { session } = await friday()

    await session.open()
    await session.narrowTo(UNFILED)

    expect(bodiesOf(session.snapshot())).toEqual(['read the postmortem'])
  })

  it('shows an empty day rather than falling back to Any', async () => {
    const { session } = await friday()

    await session.open()
    await session.narrowTo({ kind: 'named', name: 'infra' })

    expect(bodiesOf(session.snapshot())).toEqual([])
  })

  it('copies the Digest of the narrowed Filter, Bodies only', async () => {
    const { session, clipboard } = await friday()

    await session.open()
    await session.narrowTo({ kind: 'named', name: 'api' })
    session.copy()
    await settle()

    expect(clipboard.written).toEqual(['- rate limits'])
    expect(session.snapshot().confirmation).toBe('Copied 1 Note.')
  })

  it('holds the constraint while the day axis moves', async () => {
    const { session } = await sessionOver([
      { at: '2026-03-09T10:00:00', body: '#api the retry storm' },
      { at: '2026-03-09T11:00:00', body: 'Monday, unfiled' },
      { at: '2026-03-13T10:00:00', body: '#api rate limits' },
    ])

    await session.open()
    await session.narrowTo({ kind: 'named', name: 'api' })
    await session.moveTo(rangeForDays('2026-03-09', '2026-03-13'))

    expect(session.snapshot().filter?.project).toEqual({
      kind: 'named',
      name: 'api',
    })
    expect(bodiesOf(session.snapshot())).toEqual([
      'rate limits',
      'the retry storm',
    ])
  })

  it('holds the constraint while a Note arrives', async () => {
    const { session, capture } = await friday()

    await session.open()
    await session.narrowTo({ kind: 'named', name: 'api' })
    await capture('2026-03-13T13:00:00', '#billing another invoice')
    await session.noteArrived('2026-03-13')

    expect(session.snapshot().filter?.project).toEqual({
      kind: 'named',
      name: 'api',
    })
    expect(bodiesOf(session.snapshot())).toEqual(['rate limits'])
  })

  it('does not nudge for a Note the constraint excludes but the days hold', async () => {
    const { session, capture } = await friday()

    await session.open()
    await session.narrowTo({ kind: 'named', name: 'api' })
    await capture('2026-03-13T13:00:00', '#billing another invoice')
    await session.noteArrived('2026-03-13')

    expect(session.snapshot().nudgedDay).toBeNull()
  })

  it('still nudges for a Note outside the day range, Project or not', async () => {
    const { session, capture } = await friday()

    await session.open()
    await session.narrowTo({ kind: 'named', name: 'api' })
    await capture('2026-03-16T10:00:00', '#api Monday')
    await session.noteArrived('2026-03-16')

    expect(session.snapshot().nudgedDay).toBe('2026-03-16')
  })

  it('searches the whole journal regardless of the constraint, and keeps it', async () => {
    const { session } = await friday()

    await session.open()
    await session.narrowTo({ kind: 'named', name: 'api' })
    await session.search('invoices')

    // A Search is Body-only over every Note: the narrow is not a filter on it.
    expect(resultsOf(session.snapshot())).toEqual(['invoices'])
    expect(session.snapshot().filter?.project).toEqual({
      kind: 'named',
      name: 'api',
    })
  })

  it('gives the narrowed list back when a Search ends', async () => {
    const { session } = await friday()

    await session.open()
    await session.narrowTo({ kind: 'named', name: 'api' })
    await session.search('invoices')
    await session.search('')

    expect(bodiesOf(session.snapshot())).toEqual(['rate limits'])
  })

  it('narrows a Search off the screen, back to the Filter', async () => {
    const { session } = await friday()

    await session.open()
    await session.search('invoices')
    await session.narrowTo({ kind: 'named', name: 'api' })

    expect(session.snapshot().searching).toBe(false)
    expect(bodiesOf(session.snapshot())).toEqual(['rate limits'])
  })
})

describe('a Note arriving while History is open', () => {
  it('shows a Note filed under a day in the Filter', async () => {
    const { session, capture } = await sessionOver([
      { at: '2026-03-13T10:00:00', body: 'Friday' },
    ])

    await session.open()
    await capture('2026-03-13T11:00:00', 'Later on Friday')
    await session.noteArrived('2026-03-13')

    expect(bodiesOf(session.snapshot())).toEqual(['Later on Friday', 'Friday'])
    expect(session.snapshot().nudgedDay).toBeNull()
  })

  it('nudges rather than moving the Filter under the reader', async () => {
    const { session, capture } = await sessionOver([
      { at: '2026-03-13T10:00:00', body: 'Friday' },
    ])

    await session.open()
    await capture('2026-03-16T10:00:00', 'Monday')
    await session.noteArrived('2026-03-16')

    expect(session.snapshot().filter).toEqual(anyProjectOn('2026-03-13'))
    expect(bodiesOf(session.snapshot())).toEqual(['Friday'])
    expect(session.snapshot().nudgedDay).toBe('2026-03-16')
  })

  it('opens on the first Note ever captured, having had no Filter to hold', async () => {
    const { session, capture } = await sessionOver([])

    await session.open()
    expect(session.snapshot().history).toEqual({ state: 'empty' })

    await capture('2026-03-13T10:00:00', 'The first one')
    await session.noteArrived('2026-03-13')

    expect(session.snapshot().filter).toEqual(anyProjectOn('2026-03-13'))
    expect(bodiesOf(session.snapshot())).toEqual(['The first one'])
  })

  it('drops the Nudge once the reader acts on it', async () => {
    const { session, capture } = await sessionOver([
      { at: '2026-03-13T10:00:00', body: 'Friday' },
    ])

    await session.open()
    await capture('2026-03-16T10:00:00', 'Monday')
    await session.noteArrived('2026-03-16')
    session.dismissNudge()

    expect(session.snapshot().nudgedDay).toBeNull()
  })
})

describe('correcting a Note', () => {
  it('shows the reworded Body', async () => {
    const { session, notes } = await sessionOver([
      { at: '2026-03-13T10:00:00', body: 'Friday' },
    ])

    await session.open()
    await session.editBody(notes[0].id, 'Friday, reworded')

    expect(bodiesOf(session.snapshot())).toEqual(['Friday, reworded'])
  })

  it('shows the Note under its new Project', async () => {
    const { session, notes } = await sessionOver([
      { at: '2026-03-13T10:00:00', body: 'Friday' },
    ])

    await session.open()
    await session.editProject(notes[0].id, 'habic')

    expect(projectsOf(session.snapshot())).toEqual(['habic'])
  })

  it('drops a Note refiled out of the Filter from the list', async () => {
    const { session, notes } = await sessionOver([
      { at: '2026-03-13T10:00:00', body: 'Friday' },
      { at: '2026-03-13T11:00:00', body: 'Also Friday' },
    ])

    await session.open()
    await session.refile(notes[0].id, '2026-03-09')

    expect(bodiesOf(session.snapshot())).toEqual(['Also Friday'])
  })

  it('drops a deleted Note from the list', async () => {
    const { session, notes } = await sessionOver([
      { at: '2026-03-13T10:00:00', body: 'Friday' },
      { at: '2026-03-13T11:00:00', body: 'Also Friday' },
    ])

    await session.open()
    await session.delete(notes[1].id)

    expect(bodiesOf(session.snapshot())).toEqual(['Friday'])
  })

  it('leaves the list as it reads when the correction fails', async () => {
    silenceErrors()
    const { session } = await sessionOver([
      { at: '2026-03-13T10:00:00', body: 'Friday' },
    ])

    await session.open()
    await session.delete('no-such-note')

    expect(bodiesOf(session.snapshot())).toEqual(['Friday'])
  })

  it('says what did not happen when a correction fails', async () => {
    silenceErrors()
    const { session, notes } = await sessionOver([
      { at: '2026-03-13T10:00:00', body: 'Friday' },
    ])

    await session.open()

    await session.delete('no-such-note')
    expect(session.snapshot().problem).toBe('That Note could not be deleted.')

    await session.refile(notes[0].id, 'not-a-day')
    expect(session.snapshot().problem).toBe('That Note could not be refiled.')

    await session.editBody(notes[0].id, '   ')
    expect(session.snapshot().problem).toBe('That Note could not be reworded.')

    await session.editProject(notes[0].id, 'not a project!')
    expect(session.snapshot().problem).toBe(
      "That Note's Project could not be changed.",
    )
  })

  it('stops saying so once a correction works', async () => {
    silenceErrors()
    const { session, notes } = await sessionOver([
      { at: '2026-03-13T10:00:00', body: 'Friday' },
    ])

    await session.open()
    await session.delete('no-such-note')
    await session.editBody(notes[0].id, 'Friday, reworded')

    expect(session.snapshot().problem).toBeNull()
  })

  it('stops saying so once the Filter moves', async () => {
    silenceErrors()
    const { session } = await sessionOver([
      { at: '2026-03-13T10:00:00', body: 'Friday' },
    ])

    await session.open()
    await session.delete('no-such-note')
    await session.moveTo(rangeForJournalDay('2026-03-09'))

    expect(session.snapshot().problem).toBeNull()
  })
})

describe('searching the journal', () => {
  it('shows every matching Note in the journal, newest first, whatever the Filter', async () => {
    const { session } = await sessionOver([
      { at: '2026-03-09T10:00:00', body: 'planned the migration' },
      { at: '2026-03-11T10:00:00', body: 'nothing to do with it' },
      { at: '2026-03-13T10:00:00', body: 'ran the MIGRATION' },
    ])

    await session.open()
    await session.search('migration')

    expect(resultsOf(session.snapshot())).toEqual([
      'ran the MIGRATION',
      'planned the migration',
    ])
    // The Filter is where it was: a Search is a way in, not a narrowing.
    expect(session.snapshot().filter).toEqual(anyProjectOn('2026-03-13'))
  })

  it('asks nothing of the journal for a term of one character', async () => {
    const asked: string[] = []
    const { session } = await sessionOver(
      [{ at: '2026-03-13T10:00:00', body: 'Friday' }],
      {
        journal: (core) => ({
          ...core,
          notesMatching(term) {
            asked.push(term)
            return core.notesMatching(term)
          },
        }),
      },
    )

    await session.open()
    await session.search('F')

    expect(asked).toEqual([])
    expect(bodiesOf(session.snapshot())).toEqual(['Friday'])
    expect(session.snapshot().searching).toBe(false)
  })

  it('is showing a Search even when nothing matched', async () => {
    const { session } = await sessionOver([
      { at: '2026-03-13T10:00:00', body: 'Friday' },
    ])

    await session.open()
    await session.search('migration')

    expect(session.snapshot().history).toEqual({
      state: 'results',
      term: 'migration',
      notes: [],
    })
    expect(session.snapshot().searching).toBe(true)
  })

  it('holds the list still while a search is in flight, rather than loading', async () => {
    const slow = gate()
    const { session } = await sessionOver(
      [{ at: '2026-03-13T10:00:00', body: 'Friday' }],
      {
        journal: (core) => ({
          ...core,
          async notesMatching(term) {
            const notes = await core.notesMatching(term)
            await slow.reached(term)
            return notes
          },
        }),
      },
    )

    await session.open()
    slow.hold('Fri')
    const searching = session.search('Fri')
    await afterDebounce()

    expect(bodiesOf(session.snapshot())).toEqual(['Friday'])

    slow.release('Fri')
    await searching

    expect(resultsOf(session.snapshot())).toEqual(['Friday'])
  })

  it('lets only the newest of two overlapping searches reach the view', async () => {
    const slow = gate()
    const { session } = await sessionOver(
      [
        { at: '2026-03-13T10:00:00', body: 'the migration' },
        { at: '2026-03-13T11:00:00', body: 'the tray menu' },
      ],
      {
        journal: (core) => ({
          ...core,
          async notesMatching(term) {
            const notes = await core.notesMatching(term)
            await slow.reached(term)
            return notes
          },
        }),
      },
    )

    await session.open()
    slow.hold('migration')
    slow.hold('tray')

    // The reader kept typing: the first term is asked for first and answers
    // last, and must not land on top of the term they settled on.
    const stale = session.search('migration')
    await afterDebounce()
    const fresh = session.search('tray')
    slow.release('tray')
    await fresh
    slow.release('migration')
    await stale

    expect(resultsOf(session.snapshot())).toEqual(['the tray menu'])
    expect(session.snapshot().term).toBe('tray')
  })

  it('goes back to the Filter when the term drops below two characters', async () => {
    const { session } = await sessionOver([
      { at: '2026-03-13T10:00:00', body: 'Friday' },
    ])

    await session.open()
    await session.search('Fri')
    await session.search('')

    expect(bodiesOf(session.snapshot())).toEqual(['Friday'])
    expect(session.snapshot().term).toBe('')
    expect(session.snapshot().searching).toBe(false)
  })

  it('moves the Filter to the day a result is filed under, keeping the term', async () => {
    const { session } = await sessionOver([
      { at: '2026-03-09T10:00:00', body: 'planned the migration' },
      { at: '2026-03-09T11:00:00', body: 'and the rest of Monday' },
      { at: '2026-03-13T10:00:00', body: 'ran the migration' },
    ])

    await session.open()
    await session.search('migration')
    await session.moveTo(rangeForJournalDay('2026-03-09'))

    expect(session.snapshot().filter).toEqual(anyProjectOn('2026-03-09'))
    expect(bodiesOf(session.snapshot())).toEqual([
      'and the rest of Monday',
      'planned the migration',
    ])
    expect(session.snapshot().searching).toBe(false)
    expect(session.snapshot().term).toBe('migration')
  })

  it('nudges for a Note captured while results are showing, matching or not', async () => {
    const { session, capture } = await sessionOver([
      { at: '2026-03-13T10:00:00', body: 'ran the migration' },
    ])

    await session.open()
    await session.search('migration')
    // Filed under the day in view, and matching the term: it still nudges,
    // because there is no Filter on screen for it to belong to.
    await capture('2026-03-13T11:00:00', 'the migration again')
    await session.noteArrived('2026-03-13')

    expect(session.snapshot().nudgedDay).toBe('2026-03-13')
    expect(resultsOf(session.snapshot())).toEqual(['ran the migration'])
  })

  it('closes the results when the reader acts on that Nudge', async () => {
    const { session, capture } = await sessionOver([
      { at: '2026-03-13T10:00:00', body: 'ran the migration' },
    ])

    await session.open()
    await session.search('migration')
    await capture('2026-03-16T10:00:00', 'Monday')
    await session.noteArrived('2026-03-16')
    await session.moveTo(rangeForJournalDay('2026-03-16'))

    expect(bodiesOf(session.snapshot())).toEqual(['Monday'])
    expect(session.snapshot().nudgedDay).toBeNull()
    expect(session.snapshot().searching).toBe(false)
  })

  it('leaves the Digest bound to the Filter while a Search is showing', async () => {
    const { session, clipboard } = await sessionOver([
      { at: '2026-03-09T10:00:00', body: 'planned the migration' },
      { at: '2026-03-13T10:00:00', body: 'ran the migration' },
    ])

    await session.open()
    await session.search('migration')
    session.copy()
    await settle()

    expect(clipboard.written).toEqual(['- ran the migration'])
  })
})

describe('copying the Digest', () => {
  it('writes the whole Filter and says how many Notes went', async () => {
    const { session, clipboard } = await sessionOver([
      { at: '2026-03-13T10:00:00', body: 'Friday' },
      { at: '2026-03-13T11:00:00', body: 'Also Friday' },
    ])

    await session.open()
    session.copy()
    await settle()

    expect(clipboard.written).toEqual(['- Friday\n- Also Friday'])
    expect(session.snapshot().confirmation).toBe('Copied 2 Notes.')
  })

  it('copies the Digest as it was read, not the list on screen', async () => {
    const { session, notes, clipboard } = await sessionOver([
      { at: '2026-03-13T10:00:00', body: 'Friday' },
    ])

    await session.open()
    await session.editBody(notes[0].id, 'Friday, reworded')
    session.copy()
    await settle()

    expect(clipboard.written).toEqual(['- Friday, reworded'])
  })

  it('says there was nothing to copy rather than writing an empty Digest', async () => {
    const { session, clipboard } = await sessionOver([
      { at: '2026-03-13T10:00:00', body: 'Friday' },
    ])

    await session.open()
    await session.moveTo(rangeForJournalDay('2026-03-09'))
    session.copy()
    await settle()

    expect(clipboard.written).toEqual([])
    expect(session.snapshot().confirmation).toBe('No Notes to copy.')
  })

  it('says so when the clipboard write fails', async () => {
    silenceErrors()
    const { session, clipboard } = await sessionOver([
      { at: '2026-03-13T10:00:00', body: 'Friday' },
    ])
    clipboard.fail(new Error('not allowed'))

    await session.open()
    session.copy()
    await settle()

    expect(session.snapshot().confirmation).toBe('Could not copy.')
  })
})

/**
 * A session over a real database holding the given Notes, plus the collaborators
 * a test needs to drive it: the clipboard it writes to, a way to capture more
 * Notes behind its back, and every snapshot it has announced.
 */
async function sessionOver(
  captured: Array<{ at: string; body: string }>,
  { journal = (core: Journal) => core }: { journal?: (core: Journal) => Journal } = {},
) {
  const { driver, close } = await openTestDatabase()
  openDatabases.push(close)

  const clock = fixedClock(new Date('2026-03-09T10:00:00'))
  const core = createJournal({ clock, driver })

  const notes: Note[] = []
  async function capture(at: string, body: string) {
    clock.set(new Date(at))
    const note = await core.capture(body)
    if (note === null) throw new Error('nothing was captured')
    notes.push(note)
    return note
  }

  for (const note of captured) {
    await capture(note.at, note.body)
  }

  const clipboard = recordingClipboard()
  const seen: HistorySnapshot[] = []
  const session = createHistorySession({
    journal: Promise.resolve(journal(core)),
    clipboard: clipboard.write,
    onChange: (snapshot) => seen.push(snapshot),
  })

  return { session, capture, notes, clipboard, seen }
}

function recordingClipboard() {
  const written: string[] = []
  let failure: Error | null = null

  return {
    written,
    fail: (error: Error) => {
      failure = error
    },
    write: (text: string) => {
      if (failure !== null) return Promise.reject(failure)
      written.push(text)
      return Promise.resolve()
    },
  }
}

/** A read held open until a test lets it through, keyed by the day asked for. */
function gate() {
  const held = new Map<string, Array<() => void>>()

  return {
    /** From now on, a read of this day waits to be released. */
    hold(key: string) {
      held.set(key, [])
    },
    reached(key: string) {
      const queue = held.get(key)
      if (queue === undefined) return Promise.resolve()
      return new Promise<void>((resolve) => queue.push(resolve))
    },
    release(key: string) {
      for (const resolve of held.get(key) ?? []) resolve()
      held.delete(key)
    },
  }
}

/** The bodies on screen, in the order the list shows them. */
function bodiesOf(snapshot: HistorySnapshot): string[] {
  if (snapshot.history.state !== 'notes') {
    throw new Error(`History is ${snapshot.history.state}, not notes`)
  }
  return snapshot.history.days.flatMap((day) =>
    day.notes.map((note) => note.body),
  )
}

/** The Projects on screen, in the order the list shows them. */
function projectsOf(snapshot: HistorySnapshot): Array<string | null> {
  if (snapshot.history.state !== 'notes') {
    throw new Error(`History is ${snapshot.history.state}, not notes`)
  }
  return snapshot.history.days.flatMap((day) =>
    day.notes.map((note) => note.project),
  )
}

/** The bodies of a Search's results, in the order the list shows them. */
function resultsOf(snapshot: HistorySnapshot): string[] {
  if (snapshot.history.state !== 'results') {
    throw new Error(`History is ${snapshot.history.state}, not results`)
  }
  return snapshot.history.notes.map((note) => note.body)
}

/** Lets a `copy()` — deliberately not awaitable — finish before asserting. */
function settle() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/** Long enough for one debounced search to be asked for, and no longer. */
function afterDebounce() {
  return new Promise((resolve) => setTimeout(resolve, SEARCH_DEBOUNCE_MS + 10))
}

function silenceErrors() {
  vi.spyOn(console, 'error').mockImplementation(() => {})
}
