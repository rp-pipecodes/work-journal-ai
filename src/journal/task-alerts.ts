/**
 * Asking the OS to allow Task Alerts, and when. One rule, in one place,
 * because both surfaces that save a Task with a time have to follow it: the
 * Task Creation window and the Task Editor.
 */

import type { Desktop } from '@/platform/desktop'

/**
 * What asking came to. `unknown` is an OS that would not even say what it
 * allows — not a refusal, and never something to accuse it of.
 */
export type TaskAlertAnswer = 'granted' | 'refused' | 'unknown'

/** What a denied Task Alert says, where the user just asked for one. */
export const ALERT_REFUSED =
  'macOS is not allowing Work Journal to alert you. The Task is saved and its schedule is kept; turn notifications on in Settings to be alerted.'

/**
 * Asks macOS to allow Task Alerts, in context, when a Task with a time has
 * just been saved — and only while it has never been asked, because after an
 * answer is on file the prompt does not appear and asking again would only be
 * the app nagging.
 *
 * Nothing here can fail the save. The Task and its schedule are already
 * stored; what is at stake is only whether the OS will say so out loud — see
 * docs/adr/0017-the-os-schedules-task-alerts.md.
 *
 * A permission just given is a set of Alerts nobody has registered yet, so it
 * announces: the window that registers them is a different one.
 */
export async function askAboutTaskAlerts(
  desktop: Desktop,
): Promise<TaskAlertAnswer> {
  try {
    const permission = await desktop.taskAlertPermission()

    if (permission === 'granted') return 'granted'
    if (permission === 'denied') return 'refused'

    const answer = await desktop.requestTaskAlertPermission()
    if (answer !== 'granted') return 'refused'

    await desktop.announceTasksChanged()
    return 'granted'
  } catch (error) {
    console.error('could not ask about Task Alerts', error)
    return 'unknown'
  }
}
