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
 * It also processes Complete actions chosen on Task Alerts: the delivered slot
 * is checked against the journal, and only a Task still Open at that exact
 * slot is completed. Anything else opens Tasks View on the Task for review
 * and changes nothing.
 *
 * Nothing here ever prompts. Permission is asked for in context when the first
 * timed Task is saved, which is a thing the user did; a background
 * reconciliation that raised a dialog would be the app nagging.
 */

import type { Desktop, TaskAlertCompletion } from '@/platform/desktop'
import {
  taskAlerts,
  taskIdOfAlert,
  type Clock,
  type CompletionAtSlot,
  type Journal,
} from './journal'

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
  // an order neither of them chose. So they never overlap.
  let reconciling = false
  // But a trigger that lands mid-run is not dropped either: the run in flight
  // may already have read the journal, so what it is about to hand macOS is
  // the answer from before this change. It is asked for again the moment that
  // run ends, which is what makes "rescheduled on every change" true rather
  // than true within fifteen minutes.
  let askedAgain = false
  // Responses already handled. One Complete arrives twice when the app was not
  // running — written down for the cold launch and announced to a window
  // already listening — and a retried delivery must never complete twice.
  const seenCompletions = new Set<string>()

  /**
   * One reconciliation, and then another if anything asked while it ran. Every
   * failure stops here: a Task Alert is derived from a Task that is already
   * stored, so an OS that refuses leaves the journal exactly as it was — never
   * a rollback, and never a deleted Task.
   */
  async function reconcile(): Promise<void> {
    if (!running) return
    if (reconciling) {
      askedAgain = true
      return
    }

    reconciling = true
    try {
      do {
        askedAgain = false
        await reconcileOnce()
      } while (askedAgain && running)
    } finally {
      reconciling = false
      askedAgain = false
    }
  }

  /** The whole answer, recomputed from the record and handed to the OS. */
  async function reconcileOnce(): Promise<void> {
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
      await announce(true)
    } catch (error) {
      // Said out loud as well as logged: a Task whose Alert macOS would not
      // hold is still a Task, but the user is the only one who can tell the
      // difference between an Alert that is coming and one that is not.
      console.error('could not reconcile the Task Alerts', error)
      await announce(false)
    }
  }

  /**
   * How it went, told to whichever Tasks View is open — this window has no
   * screen to say it on. Said either way, so a failure that has since been put
   * right stops being on screen. Never worth failing a reconciliation over: an
   * announcement nobody hears leaves everything exactly as it was.
   */
  async function announce(held: boolean): Promise<void> {
    try {
      await desktop.announceTaskAlertsReconciled(held)
    } catch (error) {
      console.error('could not say how the Task Alerts went', error)
    }
  }

  /**
   * One Complete chosen on a Task Alert: the guarded completion, or Tasks View
   * opened on the Task when the banner outlived its slot. Never throws: a
   * banner is an ordinary copy of a schedule that may have moved, and a
   * failure here must not take the reconciliation with it.
   */
  async function completeFromAlert(
    response: TaskAlertCompletion,
  ): Promise<void> {
    const delivered = `${response.taskId} ${response.date} ${response.time}`
    if (seenCompletions.has(delivered)) return
    seenCompletions.add(delivered)

    // Which Task the Alert named — the journal's to say, not this session's.
    const taskId = taskIdOfAlert(response.taskId)
    if (taskId === null) {
      console.error(
        'could not complete the Task its Alert asked for',
        response.taskId,
      )
      return
    }

    let core: Journal
    try {
      core = await journal
    } catch (error) {
      console.error('could not complete the Task its Alert asked for', error)
      return
    }

    let outcome: CompletionAtSlot
    try {
      outcome = await core.completeTaskAt(taskId, {
        date: response.date,
        time: response.time,
      })
    } catch (error) {
      // No mutation happened and nothing is claimed: without the guarded
      // answer there is nothing to say the Task still exists, so there is
      // nothing to open either.
      console.error('could not complete the Task its Alert asked for', error)
      return
    }

    if (outcome.outcome === 'completed') {
      // Said the way every Task change is said: the reconciliation listening
      // above then replaces or removes the pending Alert.
      try {
        await desktop.announceTasksChanged()
      } catch (error) {
        console.error('could not announce the Task', error)
      }
      return
    }

    if (outcome.task === null) {
      // Deleted since the banner was delivered: nothing to review.
      console.error(
        'could not complete the Task its Alert asked for',
        response.taskId,
      )
      return
    }

    // Stale: the Task moved, and the banner must not move with it. No
    // mutation — Tasks View opens on it instead, for review.
    try {
      await desktop.focusTaskAlert(response.taskId)
    } catch (error) {
      console.error('could not open the Task its Alert asked for', error)
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
        // A Complete chosen on a Task Alert. Subscribed before the
        // cold-launch read below, so a response arriving in between is
        // deduplicated rather than missed or doubled.
        desktop.onTaskAlertCompleted((response) =>
          void completeFromAlert(response),
        ),
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

      // A Complete chosen while the app was not running, waiting to be
      // claimed. Read only after subscribing above.
      let pending: TaskAlertCompletion | null = null
      try {
        pending = await desktop.completedTaskAlert()
      } catch (error) {
        console.error('could not read the Task Alert completion', error)
      }
      if (pending !== null) await completeFromAlert(pending)

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
