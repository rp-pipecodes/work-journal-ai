/**
 * Yesterday's Digest, put on the clipboard from the Tray Menu.
 *
 * Capture only pays off when what went in comes back out, and the payoff this
 * app is built around is the written work log the user already owes a chat
 * group every morning. One menu item, one paste — no window to open, no Filter
 * to set, and nothing to tidy up afterwards.
 *
 * Yesterday is the previous calendar day, not the previous Occupied Day: a
 * standup post is about a date, and a Monday that quietly pasted Friday would
 * be a claim about the weekend. A day with no Notes therefore copies nothing
 * rather than reaching further back — and leaves the clipboard as it was,
 * since a blank paste is worse than no paste.
 *
 * The Filter is untouched: this window has none, and History — open or not —
 * is never moved. Copying is not navigating.
 *
 * Headless, like the tray count, and built from a Journal, a Desktop and a
 * clock, so the whole of it runs in a test with real SQL and no menu bar. It
 * holds no rule of its own: which Notes and how they read both come from the
 * core's Digest, so what pastes here is exactly what History copies.
 *
 * One of these runs per app, in the capture window — the one window that lives
 * as long as the tray does; see
 * docs/adr/0002-capture-window-is-hidden-never-closed.md.
 */

import type { Desktop, Unlisten } from '@/platform/desktop'
import {
  journalDayFor,
  rangeForPreset,
  type Clock,
  type Journal,
} from './journal'

export interface YesterdayDigest {
  /** Starts answering the Tray Menu. Resolves once it is listening. */
  start(): Promise<void>
  /** Gives up, for good. */
  stop(): void
}

export function createYesterdayDigest({
  journal,
  desktop,
  clock,
}: {
  /**
   * A promise rather than a Journal: the database opens after the first paint,
   * and the tray is on screen before it does.
   */
  journal: Promise<Journal>
  desktop: Desktop
  clock: Clock
}): YesterdayDigest {
  let running = false
  let unlisten: Unlisten | null = null

  /**
   * Yesterday, rendered and copied. The clock is read here rather than held,
   * so an app left running past midnight copies the day the user means.
   *
   * A journal that cannot be read copies nothing: the clipboard is the user's,
   * and overwriting it with an error — or with an empty Digest — would cost
   * them whatever they had already put there.
   */
  async function copy(): Promise<void> {
    try {
      const core = await journal
      const yesterday = rangeForPreset('yesterday', journalDayFor(clock.now()))
      const digest = await core.digest(yesterday)
      if (!running || digest.noteCount === 0) return
      await desktop.copyToClipboard(digest.markdown)
    } catch (error) {
      console.error("could not copy yesterday's Digest", error)
    }
  }

  return {
    async start() {
      running = true
      const stopListening = await desktop.onYesterdayDigestRequested(
        () => void copy(),
      )
      // Stopped while the subscription was still being made: give it up now,
      // rather than leaving a listener nothing will come back for.
      if (!running) {
        stopListening()
        return
      }
      unlisten = stopListening
    },

    stop() {
      running = false
      unlisten?.()
      unlisten = null
    },
  }
}
