/**
 * Keeping macOS's pending notification requests equal to what the journal
 * says: every future timed Open Task has one, and nothing else does.
 *
 * The database is authoritative and the OS's pending state is derived from it —
 * see docs/adr/0017-the-os-schedules-task-alerts.md. So there is no "schedule
 * this one" and no "cancel that one" here: there is one reconciliation, run
 * whenever the answer might have changed, and it is safe to run at any time
 * because it recomputes the whole answer from the record.
 *
 * Headless like the sweep, and built from a Journal, a Desktop and a clock, so
 * the whole of it can be driven from a test with real SQL and no OS. It holds
 * no rule of its own: which Tasks have an Alert is `taskAlerts` in the core.
 * What lives here is *when* to ask again.
 *
 * One of these runs per app, in the capture window, for the same reason the
 * sweep does: that window is built at startup and only ever hidden, so it is
 * the one place that lives as long as the app — see
 * docs/adr/0002-capture-window-is-hidden-never-closed.md.
 *
 * Nothing here ever prompts. Permission is asked for in context when the first
 * timed Task is saved, which is a thing the user did; a background
 * reconciliation that raised a dialog would be the app nagging.
 */

import type { Desktop } from '@/platform/desktop'
import { taskAlerts, type Clock, type Journal } from './journal'

/**
 * How often the pending requests are checked against the journal while the app
 * simply runs. The events below are what actually keep them true; this is the
 * backstop for the one thing no event announces — the local day rolling over
 * while nobody touches anything, which is when a Task the user scheduled for
 * "tomorrow at 09:00" stops being a day away.
 */
export const RECONCILE_INTERVAL_MS = 15 * 60 * 1000

export interface TaskAlertsSession {
  /** Reconciles, and keeps reconciling. Resolves once the first one is done. */
  start(): Promise<void>
  /** Gives all of it up, for good. */
  stop(): void
}

export function createTaskAlertsSession({
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
}): TaskAlertsSession {
  let running = false
  let interval: ReturnType<typeof setInterval> | null = null
  let unlisten: Array<() => void> = []
  // Two triggers can land together — a Task saved just as the machine wakes —
  // and two reconciliations racing would hand macOS two different answers in
  // an order neither of them chose. They never overlap; the one that arrives
  // late is dropped, and the next trigger recomputes everything anyway.
  let reconciling = false

  /**
   * One reconciliation. Every failure stops here: a Task Alert is derived from
   * a Task that is already stored, so an OS that refuses leaves the journal
   * exactly as it was — never a rollback, and never a deleted Task.
   */
  async function reconcile(): Promise<void> {
    if (!running || reconciling) return
    reconciling = true

    try {
      const permission = await desktop.taskAlertPermission()
      if (permission !== 'granted') {
        // Nothing to register, and nothing to ask. A permission restored in
        // System Settings is picked up by the next trigger — which is what
        // makes the interval worth having — and it registers the Tasks that
        // are still ahead without ever replaying the ones that are not.
        return
      }

      const core = await journal
      const alerts = taskAlerts(await core.openTasks(), clock.now())
      if (!running) return

      await desktop.reconcileTaskAlerts(alerts)
    } catch (error) {
      console.error('could not reconcile the Task Alerts', error)
    } finally {
      reconciling = false
    }
  }

  return {
    async start() {
      running = true
      const stopListening = await Promise.all([
        // A Task was created, reworded, rescheduled, completed, reopened or
        // deleted — in this window or any other. The pending requests are a
        // copy of an answer that has just changed.
        desktop.onTasksChanged(() => void reconcile()),
        // A sleeping Mac runs no timers. macOS keeps its own pending requests
        // across sleep, so this is about the journal having moved on rather
        // than about the OS having forgotten.
        desktop.onSystemWoke(() => void reconcile()),
      ])

      if (!running) {
        for (const stop of stopListening) stop()
        return
      }
      unlisten = stopListening

      // The launch reconciliation, before the interval: whatever changed while
      // the app was not running, and whatever the OS lost when it was
      // reinstalled or its permission was turned back on.
      await reconcile()
      interval = setInterval(() => void reconcile(), RECONCILE_INTERVAL_MS)
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
