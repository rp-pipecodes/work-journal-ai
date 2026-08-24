/**
 * The sweep: today's meetings, turned into Notes without anybody being asked.
 *
 * Headless like the tray count, and built from a Journal, a Desktop, the
 * settings and a clock — so the whole of it can be driven from a test with real
 * SQL, no calendar and no menu bar. It holds no rule of its own: which events
 * become Notes is `meetingsToImport`, and what an Import writes is
 * `importMeeting`. What lives here is *when* to look.
 *
 * Today and only today — never yesterday, never a backfill, including the first
 * time Import is turned on; see
 * docs/adr/0011-imported-meetings-are-today-only.md. A meeting becomes a Note
 * as it ends, which is what the interval is for, and the wake and the launch
 * sweeps are the catch-up for the ones that ended while the machine was asleep.
 *
 * It never Nudges. A Nudge means "you wrote something on another day", which is
 * a fact about the user rather than about a sweep — so Imported Notes land
 * silently, and the only announcement made is that a count taken before is now
 * out of date.
 *
 * One of these runs per app, in the capture window, for the same reason the
 * tray count does: that window is built at startup and only ever hidden, so it
 * is the one place that lives as long as the app — see
 * docs/adr/0002-capture-window-is-hidden-never-closed.md.
 */

import type { Desktop } from '@/platform/desktop'
import type { AppSettings } from '@/settings/app-settings'
import { meetingsToImport, type Clock, type Journal } from './journal'

/**
 * How often the calendar is looked at. Meetings become Notes as they end, and
 * "as" is this: near enough that the morning is already in the journal by
 * lunchtime, far enough apart that a machine that is asleep or busy is not
 * being woken to read a calendar nobody is looking at.
 */
export const SWEEP_INTERVAL_MS = 5 * 60 * 1000

export interface ImportSession {
  /**
   * Sweeps, and keeps sweeping: arms the interval and subscribes to the
   * moments worth looking again. Resolves once the first sweep is done.
   */
  start(): Promise<void>
  /** Gives all of it up, for good. */
  stop(): void
}

export function createImportSession({
  journal,
  desktop,
  settings,
  clock,
}: {
  /**
   * A promise rather than a Journal: the database opens after the first paint,
   * and the capture window is on screen before it does.
   */
  journal: Promise<Journal>
  desktop: Desktop
  settings: AppSettings
  clock: Clock
}): ImportSession {
  let running = false
  let interval: ReturnType<typeof setInterval> | null = null
  let unlisten: Array<() => void> = []
  // Two triggers can land together — a wake and a Capture, say — and a second
  // sweep reading the calendar while the first is still writing would import
  // the same meeting twice, since a meeting is only handled once it is written
  // down. Sweeps therefore never overlap; the one that arrives late is dropped,
  // and the next trigger picks up anything it would have found.
  let sweeping = false

  /**
   * One look at today. Every failure stops at this function: a calendar that
   * cannot be read is a gap in the journal, and the journal is the thing that
   * has to keep working — the app never nags and never breaks over this.
   */
  async function sweep(): Promise<void> {
    if (!running || sweeping) return
    sweeping = true

    try {
      const { importMeetings, importCalendars } = await settings.load()
      if (!importMeetings) return

      const access = await desktop.calendarAccess()
      if (access !== 'granted') {
        // Refused or revoked — including by macOS having no record of this
        // build, which is routine. The toggle goes back to off, and Settings
        // says why the next time it is opened. Nothing is asked of the user
        // here: a background sweep is not a place to raise a prompt.
        await settings.saveImportMeetings(false)
        return
      }

      const events = await desktop.todaysCalendarEvents()
      const meetings = meetingsToImport({
        events,
        calendarIds: importCalendars,
        now: clock.now(),
      })

      const core = await journal
      let imported = 0
      for (const meeting of meetings) {
        if (!running) return
        const note = await core.importMeeting(meeting)
        if (note !== null) imported += 1
      }

      // Only that the Notes are no longer what they were: a history window on
      // screen re-reads, and the tray count re-counts and finds itself
      // unchanged. Never `announceCapturedNote` — that one names a day for the
      // reader's Filter, and a sweep has nothing to say about the user.
      if (imported > 0) {
        await desktop.announceJournalChanged()
      }
    } catch (error) {
      console.error('could not import today’s meetings', error)
    } finally {
      sweeping = false
    }
  }

  return {
    async start() {
      running = true
      const stopListening = await Promise.all([
        // The catch-up: a lid closed before a meeting ended would otherwise
        // lose it for good, since nothing ever looks back past today.
        desktop.onSystemWoke(() => void sweep()),
        // A Capture beginning is the one moment this hidden window is
        // certainly awake, and it costs nothing to look then.
        desktop.onCaptureShown(() => void sweep()),
        // Turning Import on, or ticking another calendar, should show up in
        // the journal now rather than at the next interval.
        desktop.onImportChanged(() => void sweep()),
      ])

      if (!running) {
        for (const stop of stopListening) stop()
        return
      }
      unlisten = stopListening

      // The launch sweep, before the interval: anything from today that was
      // missed while the app was not running.
      await sweep()
      interval = setInterval(() => void sweep(), SWEEP_INTERVAL_MS)
    },

    stop() {
      running = false
      if (interval !== null) clearInterval(interval)
      interval = null
      for (const stop of unlisten) stop()
      unlisten = []
    },
  }
}
