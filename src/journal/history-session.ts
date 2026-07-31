/**
 * Reading back what you did, as a session rather than a screen: one Filter, the
 * list it resolves to, the Nudge a Note outside it leaves, and the Digest kept
 * ready for the clipboard. Every sequencing rule of reading back lives here —
 * what an arrival does, what a correction re-reads, which of two overlapping
 * reads may reach the view — so the history window is JSX over a snapshot.
 *
 * Headless on purpose: it is built from a Journal and a clipboard and nothing
 * else, so the rules can be driven end to end from a test with real SQL and no
 * DOM. It holds no domain rule of its own — those stay in the core, which this
 * module asks.
 *
 * A session is built per history window and is never reset: the window is
 * created on demand and genuinely closed on dismiss — see
 * docs/adr/0002-capture-window-is-hidden-never-closed.md.
 */

import {
  decideArrival,
  describeCopiedDigest,
  groupByJournalDay,
  type Digest,
  type Filter,
  type Journal,
  type JournalDayGroup,
} from './journal'

/** What History has to show, once the core has been asked. */
export type HistoryState =
  | { state: 'loading' }
  | { state: 'empty' }
  | { state: 'notes'; days: JournalDayGroup[] }
  | { state: 'unreadable' }

/** Everything a history window renders, and the only thing it renders. */
export interface HistorySnapshot {
  /** Null until the first read lands, and whenever there are no Notes at all. */
  filter: Filter | null
  history: HistoryState
  /** The day a Nudge is about; null when there is nothing to nudge about. */
  nudgedDay: string | null
  /**
   * What the last copy did, said back to the reader so they know it worked
   * before they paste. Nothing until they copy, and until they move the Filter.
   */
  confirmation: string | null
  /**
   * A correction the record refused, said in the app's voice rather than the
   * error's. Nothing until one fails, and gone again the moment one succeeds or
   * the Filter moves — a list that reads as the reader asked claims nothing.
   */
  problem: string | null
}

/** Where every session starts: nothing asked yet, so nothing to show. */
export const openingSnapshot: HistorySnapshot = {
  filter: null,
  history: { state: 'loading' },
  nudgedDay: null,
  confirmation: null,
  problem: null,
}

export interface HistorySession {
  /** What a view would render right now. */
  snapshot(): HistorySnapshot
  /** The first read: the most recent Occupied Day, or nothing to open on. */
  open(): Promise<void>
  /** Every move of the Filter, and one of the two ways a Nudge is cleared. */
  moveTo(filter: Filter): Promise<void>
  /** A Note was captured, in this window or another one. */
  noteArrived(journalDay: string): Promise<void>
  /** The other way: the day gained content and the reader does not care. */
  dismissNudge(): void
  editBody(id: string, body: string): Promise<void>
  refile(id: string, journalDay: string): Promise<void>
  delete(id: string): Promise<void>
  /**
   * The whole Filter on the clipboard. Deliberately not async: the webview only
   * allows a clipboard write while the click is still granting user activation,
   * which no await survives, so the Digest is held rather than fetched here.
   */
  copy(): void
}

export function createHistorySession({
  journal,
  clipboard,
  onChange,
}: {
  /**
   * Handed in rather than imported, so a test can drive a real one. Awaited
   * rather than held: the app's journal opens a database before it exists, and
   * a session is built while that is still in flight.
   */
  journal: Promise<Journal>
  clipboard: (text: string) => Promise<void>
  onChange: (snapshot: HistorySnapshot) => void
}): HistorySession {
  let snapshot = openingSnapshot
  // Reads can overlap — a Nudge acted on while a range change is still in
  // flight — and only the newest one may reach the view.
  let latestRead = 0
  // The Filter as Markdown, kept ready for a copy. Read from the core with the
  // list, so what gets copied is never the list on screen.
  let digest: Digest | null = null

  function show(change: Partial<HistorySnapshot>): void {
    snapshot = { ...snapshot, ...change }
    onChange(snapshot)
  }

  /** Better than a window that never stops loading, and never a stale read. */
  function giveUp(error: unknown, ticket: number): void {
    console.error('could not read the journal', error)
    if (latestRead === ticket) show({ history: { state: 'unreadable' } })
  }

  async function read(filter: Filter): Promise<void> {
    const ticket = ++latestRead
    try {
      const core = await journal
      // The list and the Digest are the same Notes in opposite orders, and both
      // are asked of the core.
      const [notes, rendered] = await Promise.all([
        core.notesForFilter(filter),
        core.digest(filter),
      ])
      if (latestRead !== ticket) return
      digest = rendered
      show({ history: { state: 'notes', days: groupByJournalDay(notes) } })
    } catch (error) {
      giveUp(error, ticket)
    }
  }

  /** Where History opens, and where it returns once the first Note exists. */
  async function open(): Promise<void> {
    const ticket = ++latestRead
    let opening: Filter | null
    try {
      const core = await journal
      // The Filter opens on the most recent Occupied Day, whenever that was;
      // with no Notes at all there is no day to open on.
      opening = await core.defaultFilter()
      if (latestRead !== ticket) return
    } catch (error) {
      giveUp(error, ticket)
      return
    }

    if (opening === null) {
      show({ history: { state: 'empty' } })
      return
    }
    await moveTo(opening)
  }

  async function moveTo(filter: Filter): Promise<void> {
    show({
      filter,
      nudgedDay: null,
      // A confirmation is about the Filter that was copied, not this one; a
      // problem is about a Note in the list being left behind.
      confirmation: null,
      problem: null,
    })
    await read(filter)
  }

  /**
   * One correction to the record, then the list as it now reads. A refiled Note
   * can leave the Filter and a deleted one is gone, so the list is re-read from
   * the core rather than patched in place.
   *
   * A refused correction leaves a list that looks exactly as it would if the
   * reader had never asked, so it has to say so: `refusal` is what did not
   * happen, in the app's voice rather than the error's.
   */
  async function correct(
    refusal: string,
    change: (core: Journal) => Promise<unknown>,
  ): Promise<void> {
    let problem: string | null = null
    try {
      const core = await journal
      await change(core)
    } catch (error) {
      console.error('could not change the Note', error)
      problem = refusal
    }
    // Said whether or not it changed: a correction that worked clears the one
    // before it, so no problem outlives the list it was about.
    show({ problem })
    if (snapshot.filter !== null) await read(snapshot.filter)
  }

  return {
    snapshot: () => snapshot,
    open,
    moveTo,

    async noteArrived(journalDay) {
      // No Notes at all until now: there is no Filter to hold still, and the
      // empty state has just stopped being true.
      if (snapshot.filter === null) {
        await open()
        return
      }

      const arrival = decideArrival(snapshot.filter, journalDay)
      if (arrival.kind === 'show') {
        await read(snapshot.filter)
      } else {
        show({ nudgedDay: arrival.journalDay })
      }
    },

    dismissNudge() {
      show({ nudgedDay: null })
    },

    editBody: (id, body) =>
      correct('That Note could not be reworded.', (core) =>
        core.editBody(id, body),
      ),
    refile: (id, journalDay) =>
      correct('That Note could not be refiled.', (core) =>
        core.refile(id, journalDay),
      ),
    delete: (id) =>
      correct('That Note could not be deleted.', (core) => core.delete(id)),

    copy() {
      const copied = digest
      if (copied === null) return

      if (copied.noteCount === 0) {
        show({ confirmation: describeCopiedDigest(copied) })
        return
      }

      clipboard(copied.markdown).then(
        () => show({ confirmation: describeCopiedDigest(copied) }),
        (error: unknown) => {
          console.error('could not copy the Digest', error)
          show({ confirmation: 'Could not copy.' })
        },
      )
    },
  }
}
