import { describe, expect, it } from 'vitest'
import { fakeDesktop } from './testing/desktop'
import type { TaskAlertCompletion } from './desktop'

// The Complete half of a Task Alert response, carried through the platform
// seam: announced live to the Capture window, and kept for a cold launch to
// claim. Written against the fake, which is the same surface the app runs on.
const completion: TaskAlertCompletion = {
  alertId: 'task:task-1',
  date: '2026-03-16',
  time: '17:00',
}

describe('a Complete action on a Task Alert', () => {
  it('reaches a live listener with the exact delivered slot', async () => {
    const desktop = fakeDesktop()
    const heard: TaskAlertCompletion[] = []
    await desktop.onTaskAlertCompleted((response) => heard.push(response))

    desktop.completeTaskAlert(completion)

    expect(heard).toEqual([completion])
  })

  it('waits as a cold-launch pending response until claimed exactly once', async () => {
    const desktop = fakeDesktop()
    desktop.completeTaskAlert(completion)

    expect(await desktop.completedTaskAlert()).toEqual(completion)
    expect(await desktop.completedTaskAlert()).toBeNull()
  })

  it('leaves the default-click handoff untouched', async () => {
    const desktop = fakeDesktop()
    desktop.completeTaskAlert(completion)

    expect(await desktop.openedTaskAlert()).toBeNull()
  })
})
