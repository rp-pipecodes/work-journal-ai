/**
 * The half of a Search every section does the same way: how long a term has
 * to stand still before it is asked of the journal, how short a term is worth
 * asking about, and letting go of a term that will never be asked for.
 * Extracted on its own rather than copied per section — a rule shared by two
 * surfaces, which two copies would let drift apart; see
 * docs/adr/0025-a-session-is-for-sequencing-not-for-state.md.
 *
 * What a settled term lands on stays in the session: the results arm of its
 * state, and where the screen goes back to. That destination is the only part
 * that differs per record — see
 * docs/adr/0036-search-is-one-term-and-its-destination-is-what-changes.md.
 */

/**
 * How long a term has to stand still before it is asked of the journal. Short
 * enough to feel like typing, long enough that a word is one read rather than
 * seven.
 */
export const SEARCH_DEBOUNCE_MS = 150

/**
 * The shortest term worth asking about. One character matches most of a
 * journal, which is a slower way of showing the reader nothing.
 */
export const SEARCH_MIN_TERM_LENGTH = 2

export function createSearch({
  showTerm,
  run,
  stop,
}: {
  /**
   * The field answered at once, so typing never lags: the term it shows, and
   * whether results have taken the screen over.
   */
  showTerm: (term: string, searching: boolean) => void
  /**
   * One settled term, asked of the journal and shown. Ticket-guarded by the
   * session, so only the newest read lands.
   */
  run: (term: string) => Promise<void>
  /** The screen back to the list it never stopped having. */
  stop: () => Promise<void>
}): {
  /**
   * The term as it now reads, after every keystroke. Nothing is asked of the
   * journal until it has stood still for `SEARCH_DEBOUNCE_MS` and is at least
   * `SEARCH_MIN_TERM_LENGTH` long; a shorter term takes the results off the
   * screen and gives the list back. Resolves once the term it was given has
   * either landed or been overtaken, so a test can await it.
   */
  search: (term: string) => Promise<void>
  /** A term that will never be asked for now, let go of without asking. */
  abandonWaitingTerm: () => void
} {
  // A term waiting out its debounce, and how to abandon it: the reader typed
  // another character, or the list moved out from under it.
  let waiting: { cancel: () => void } | null = null

  /** A term that will never be asked for now, let go of without asking. */
  function abandonWaitingTerm(): void {
    waiting?.cancel()
    waiting = null
  }

  /**
   * A term as the reader typed it. The field is answered at once so typing
   * never lags, but the journal is asked only once the term has stood still —
   * and the list keeps whatever it is showing until that read lands, so there
   * is no loading state to flash between keystrokes.
   */
  function search(term: string): Promise<void> {
    abandonWaitingTerm()
    const showing = term.length >= SEARCH_MIN_TERM_LENGTH
    showTerm(term, showing)

    if (!showing) return stop()

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        waiting = null
        void run(term).then(resolve)
      }, SEARCH_DEBOUNCE_MS)

      waiting = {
        cancel: () => {
          clearTimeout(timer)
          // The term it was given has been overtaken, which is as settled as
          // it is ever going to get.
          resolve()
        },
      }
    })
  }

  return { search, abandonWaitingTerm }
}
