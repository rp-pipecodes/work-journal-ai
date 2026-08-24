/**
 * Today's Captured Note count, kept beside the menu bar glyph.
 *
 * The app never asks the user to write anything — no prompts, no scheduled
 * nudges — so this number is the only reminder there is, and the only reason
 * the app is noticed on a day nothing has been typed. It therefore has to be
 * true at every moment the menu bar is on screen: whenever a Note is captured
 * or deleted, whenever the Journal Day turns over, and whenever a Capture
 * begins — which is the one moment a hidden window is certainly awake, and so
 * the backstop for a rollover a sleeping machine let slide.
 *
 * Headless, like the History session, and built from a Journal, a Desktop and a
 * clock: the whole of it can be driven from a test with real SQL, no webview
 * and no menu bar. It holds no rule of its own — what the count is and how it
 * reads both live in the core.
 *
 * One of these runs per app, in the capture window: that window is built at
 * startup and only ever hidden, so it is the one place that lives exactly as
 * long as the tray does — see
 * docs/adr/0002-capture-window-is-hidden-never-closed.md.
 */

import type { Desktop } from '@/platform/desktop'
import {
  formatTrayCount,
  journalDayFor,
  msUntilNextJournalDay,
  type Clock,
  type Journal,
} from './journal'

export interface TrayCount {
  /**
   * Shows the count, and keeps showing it: subscribes to changes in the
   * journal and arms the midnight rollover. Resolves once the menu bar has
   * been told what today holds.
   */
  start(): Promise<void>
  /** Gives up both, for good. */
  stop(): void
}

export function createTrayCount({
  journal,
  desktop,
  clock,
}: {
  /**
   * A promise rather than a Journal: the database opens after the first paint,
   * and the capture window is on screen before it does.
   */
  journal: Promise<Journal>
  desktop: Desktop
  clock: Clock
}): TrayCount {
  let running = false
  let rollover: ReturnType<typeof setTimeout> | null = null
  let unlisten: Array<() => void> = []
  // Reads can overlap — a rollover and a change arriving together — and only
  // the newest may reach the glyph, as everywhere else in the app.
  let latestRead = 0

  /**
   * Today, counted and shown. A journal that cannot be read leaves the glyph
   * exactly as it was: a count that silently fell to nothing would say the user
   * has written nothing today, which is a worse lie than a stale number.
   */
  async function show(): Promise<void> {
    const ticket = ++latestRead
    try {
      const core = await journal
      const count = await core.capturedNoteCount(journalDayFor(clock.now()))
      if (!running || latestRead !== ticket) return
      await desktop.showTrayCount(formatTrayCount(count))
    } catch (error) {
      console.error('could not show the tray count', error)
    }
  }

  /**
   * Waits out the rest of the day and starts the next one over. Rearmed from
   * the clock each time rather than repeating on a fixed interval, so a day
   * shortened or lengthened by a DST transition — or a timer that fired late
   * because the machine was asleep — still turns the count over at midnight.
   */
  function armRollover(): void {
    if (!running) return
    rollover = setTimeout(() => {
      void show().then(armRollover)
    }, msUntilNextJournalDay(clock.now()))
  }

  return {
    async start() {
      running = true
      const stopListening = await Promise.all([
        desktop.onJournalChanged(() => void show()),
        // The rollover cannot be trusted on its own: the window this runs in is
        // hidden for its whole life, so its timers are throttled and coalesced,
        // and a machine asleep through midnight wakes with the glyph still
        // claiming yesterday's total. A Capture beginning is both the moment
        // that matters most and the one moment this window is certainly awake.
        desktop.onCaptureShown(() => void show()),
      ])
      // Stopped while the subscriptions were still being made: give them up
      // now, rather than leaving listeners nothing will ever come back for.
      if (!running) {
        for (const stop of stopListening) stop()
        return
      }
      unlisten = stopListening
      await show()
      armRollover()
    },

    stop() {
      running = false
      if (rollover !== null) clearTimeout(rollover)
      rollover = null
      for (const stop of unlisten) stop()
      unlisten = []
    },
  }
}
