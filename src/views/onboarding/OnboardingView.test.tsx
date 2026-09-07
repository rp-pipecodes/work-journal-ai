// @vitest-environment jsdom

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ThemeProvider from '@/components/ThemeProvider'
import { fakeDesktop, type FakeDesktop } from '@/platform/testing/desktop'
import { createAppSettings } from '@/settings/app-settings'
import OnboardingView from './OnboardingView'

// The Start at Login step of the flow, as the user meets it: the same login
// item the Settings switch drives, saved the moment a choice is made, with a
// refusal said in the step and a retry that behaves like a fresh press.

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

// jsdom has no media queries, and the Theme provider asks the OS which
// palette it prefers.
beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia
})

function showFlow(desktop: FakeDesktop) {
  const settings = createAppSettings(desktop)
  const done = vi.fn()
  const viewNote = vi.fn()
  render(
    <ThemeProvider settings={settings}>
      <OnboardingView desktop={desktop} settings={settings} onDone={done} onViewNote={viewNote} />
    </ThemeProvider>,
  )
  return { done, viewNote }
}

/** The switch at its step, found the way the user finds it. */
function startAtLoginSwitch(): HTMLElement {
  return screen.getByRole('switch', { name: 'Start at login' })
}

/** The switch's read, as the accessibility tree reports it. */
function readsOn(control: HTMLElement): boolean {
  return control.getAttribute('aria-checked') === 'true'
}

/** Walks the flow to the Start at Login step and returns a clicker. */
async function atTheStartAtLoginStep() {
  const user = userEvent.setup()
  await user.click(
    await screen.findByRole('button', { name: 'Continue' }),
  )
  await screen.findByRole('heading', { name: 'Start Work Journal at login?' })
  return user
}

/** Walks the flow to the Meeting Import step and returns a clicker. */
async function atTheMeetingImportStep() {
  const user = await atTheStartAtLoginStep()
  await user.click(screen.getByRole('button', { name: 'Continue' }))
  await screen.findByRole('heading', {
    name: "Add today's meetings to the journal?",
  })
  return user
}

/** The Import switch at its step, found the way the user finds it. */
function importSwitch(): HTMLElement {
  return screen.getByRole('switch', {
    name: "Add today's meetings to the journal",
  })
}

describe('the Start at Login step', () => {
  it('discards an older rollback still in flight when a newer press lands', async () => {
    // Press A turns the switch on: the OS accepts, then the file write
    // refuses, so the rollback re-reads the OS. The read is serviced before
    // press B turns it off again, and resolves after — the older rollback's
    // captured true must not be put back over the newer change, or the
    // switch would read on while the OS and the file held false.
    const stored: Record<string, unknown> = {}
    // The file takes the first start-at-login write and refuses it.
    let startAtLoginWrites = 0
    const desktop = fakeDesktop({
      stored,
      openSettingsStore: async () => ({
        async get<T>(key: string) {
          return stored[key] as T | undefined
        },
        async has(key: string) {
          return key in stored
        },
        async set(key: string, value: unknown) {
          if (key === 'startAtLogin') {
            startAtLoginWrites += 1
            if (startAtLoginWrites === 1) {
              throw new Error('the file is read-only')
            }
          }
          stored[key] = value
        },
      }),
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    // The OS read for press A's rollback: serviced now, delivered when the
    // test says so. Any other read is answered immediately.
    let releaseRead = () => {}
    const readAnswered = new Promise<void>((resolve) => {
      releaseRead = resolve
    })
    let gated = false
    let captured: boolean | null = null
    desktop.startsAtLogin = () => {
      const value = desktop.loginItem
      if (!gated) return Promise.resolve(value)
      gated = false
      captured = value
      return readAnswered.then(() => value)
    }

    showFlow(desktop)
    const user = await atTheStartAtLoginStep()

    // Press A: the login item moves, the file write refuses, and the
    // rollback's read is now in flight.
    gated = true
    await user.click(startAtLoginSwitch())
    await expect.poll(() => captured).toBe(true)

    // Press B: off, and this write reaches the file.
    await user.click(startAtLoginSwitch())
    await expect.poll(() => desktop.stored.startAtLogin).toBe(false)

    releaseRead()

    // The rollback's delivery has had its chance by the time a macrotask
    // runs — its state update is discarded, so the switch still agrees with
    // the OS and the file.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(readsOn(startAtLoginSwitch())).toBe(false)
    expect(desktop.loginItem).toBe(false)
    expect(desktop.stored.startAtLogin).toBe(false)
  })

  it('puts the switch back on when a refused choice is retried successfully', async () => {
    // The OS refuses the first change, so nothing moves and the switch rolls
    // back to where it was. The retry is a fresh press: it must say what it
    // wants on the switch as it saves, not leave the rolled-back value there
    // while the OS and the file hold the opposite.
    let changesAsked = 0
    const desktop = fakeDesktop({ stored: {} })
    desktop.setStartAtLogin = async () => {
      changesAsked += 1
      if (changesAsked === 1) throw new Error('macOS refused')
      desktop.loginItem = true
    }
    vi.spyOn(console, 'error').mockImplementation(() => {})

    showFlow(desktop)
    const user = await atTheStartAtLoginStep()

    await user.click(startAtLoginSwitch())

    // Refused before anything moved, and the switch agrees with the OS.
    await screen.findByText(
      'Could not change whether Work Journal starts at login.',
    )
    await expect.poll(() => desktop.loginItem).toBe(false)
    expect(readsOn(startAtLoginSwitch())).toBe(false)

    await user.click(
      screen.getByRole('button', {
        name: 'Try saving the Start at Login choice again',
      }),
    )

    // The retry took, and the switch says so.
    await expect.poll(() => desktop.loginItem).toBe(true)
    await expect.poll(() => desktop.stored.startAtLogin).toBe(true)
    await expect.poll(() => readsOn(startAtLoginSwitch())).toBe(true)
  })
})

describe('the Meeting Import step', () => {
  it('appears after Start at Login and finishes in History as the last setup step', async () => {
    const desktop = fakeDesktop({ stored: {} })
    const { done } = showFlow(desktop)

    const user = await atTheMeetingImportStep()

    // The last available optional setup step finishes the flow directly.
    await user.click(screen.getByRole('button', { name: 'Open History' }))
    expect(done).toHaveBeenCalledTimes(1)
  })

  it('asks macOS for nothing on entering or replaying the step', async () => {
    // Entering: never asked, and the step must not ask on the user's behalf.
    const desktop = fakeDesktop({ stored: {} })
    showFlow(desktop)
    await atTheMeetingImportStep()
    expect(desktop.prompted).toBe(false)

    // Replaying with a saved wish: reads the saved values back without
    // asking again, even though permission is still undetermined.
    cleanup()
    const replayed = fakeDesktop({
      stored: { importMeetings: true, importCalendars: [] },
      access: 'undetermined',
    })
    showFlow(replayed)
    await atTheMeetingImportStep()
    expect(replayed.prompted).toBe(false)
    expect(readsOn(importSwitch())).toBe(false)
  })

  it('enables Import over the existing permission path and ticks a work calendar', async () => {
    const desktop = fakeDesktop({
      stored: {},
      calendars: [{ id: 'work', title: 'Work', source: 'iCloud' }],
    })
    showFlow(desktop)
    const user = await atTheMeetingImportStep()

    // Explicit enablement is the one moment the calendar is asked for.
    await user.click(importSwitch())

    await expect.poll(() => desktop.prompted).toBe(true)
    await expect.poll(() => desktop.stored.importMeetings).toBe(true)
    const work = await screen.findByRole('checkbox', { name: /Work/ })
    expect(readsOn(importSwitch())).toBe(true)

    await user.click(work)

    // The tick is saved the moment it is made — the existing Import
    // behavior reads this very list, so no second service is involved.
    await expect.poll(() => desktop.stored.importCalendars).toEqual(['work'])
    expect(
      await screen.findByText(/meetings from Work will be imported/),
    ).toBeTruthy()
  })

  it('explains a refused permission, offers a retry, and always allows continuation', async () => {
    const desktop = fakeDesktop({
      stored: {},
      answersPrompt: 'denied',
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { done } = showFlow(desktop)
    const user = await atTheMeetingImportStep()

    await user.click(importSwitch())

    // The refusal is said plainly, with the way back through System Settings.
    expect(
      await screen.findByText(/macOS is not allowing Work Journal/),
    ).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Try allowing calendar access again' }),
    ).toBeTruthy()
    // The wish is kept, not discarded: a grant given in System Settings
    // later resumes Import without being asked for a second time.
    await expect.poll(() => desktop.stored.importMeetings).toBe(true)
    expect(readsOn(importSwitch())).toBe(false)

    // A refusal never blocks the journal: continuation finishes the flow.
    await user.click(screen.getByRole('button', { name: 'Open History' }))
    expect(done).toHaveBeenCalledTimes(1)
  })

  it('explains no selected calendars: permission alone imports nothing', async () => {
    const desktop = fakeDesktop({
      stored: {},
      access: 'granted',
      calendars: [{ id: 'work', title: 'Work', source: 'iCloud' }],
    })
    const { done } = showFlow(desktop)
    const user = await atTheMeetingImportStep()

    await user.click(importSwitch())
    await screen.findByRole('checkbox', { name: /Work/ })

    // Granted and on, but nothing ticked: nothing is swept, and the step
    // says so rather than claiming Import is running.
    expect(
      await screen.findByText(/permission alone imports nothing/),
    ).toBeTruthy()
    expect(desktop.stored.importCalendars ?? []).toEqual([])

    await user.click(screen.getByRole('button', { name: 'Open History' }))
    expect(done).toHaveBeenCalledTimes(1)
  })

  it('says a failed Import save, with a retry that behaves like a fresh press', async () => {
    const stored: Record<string, unknown> = {}
    let writes = 0
    const desktop = fakeDesktop({
      stored,
      access: 'granted',
      calendars: [{ id: 'work', title: 'Work', source: 'iCloud' }],
      openSettingsStore: async () => ({
        async get<T>(key: string) {
          return stored[key] as T | undefined
        },
        async has(key: string) {
          return key in stored
        },
        async set(key: string, value: unknown) {
          if (key === 'importMeetings') {
            writes += 1
            if (writes === 1) throw new Error('the file is read-only')
          }
          stored[key] = value
        },
      }),
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    showFlow(desktop)
    const user = await atTheMeetingImportStep()

    await user.click(importSwitch())

    expect(
      await screen.findByText('Could not change how meetings are imported.'),
    ).toBeTruthy()

    await user.click(
      screen.getByRole('button', { name: 'Try saving Import again' }),
    )

    await expect.poll(() => desktop.stored.importMeetings).toBe(true)
    await expect.poll(() => readsOn(importSwitch())).toBe(true)
  })

  it('says a refused calendar tick, with a retry that behaves like a fresh tick', async () => {
    const stored: Record<string, unknown> = {
      importMeetings: true,
      importCalendars: ['work'],
    }
    // The file takes the first calendars write and refuses it.
    let calendarWrites = 0
    const desktop = fakeDesktop({
      stored,
      access: 'granted',
      calendars: [{ id: 'work', title: 'Work', source: 'iCloud' }],
      openSettingsStore: async () => ({
        async get<T>(key: string) {
          return stored[key] as T | undefined
        },
        async has(key: string) {
          return key in stored
        },
        async set(key: string, value: unknown) {
          if (key === 'importCalendars') {
            calendarWrites += 1
            if (calendarWrites === 1) {
              throw new Error('the file is read-only')
            }
          }
          stored[key] = value
        },
      }),
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    showFlow(desktop)
    const user = await atTheMeetingImportStep()

    const work = await screen.findByRole('checkbox', { name: /Work/ })
    await user.click(work)

    // The refused untick is said, with a retry — and the rollback re-read
    // what the file holds, so the ticks agree with it.
    expect(
      await screen.findByText('Could not save which calendars to import.'),
    ).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Try saving the calendars again' }),
    ).toBeTruthy()
    expect(desktop.stored.importCalendars).toEqual(['work'])

    // The retry is a fresh tick of the refused selection: it takes, and the
    // ticks say so.
    await user.click(
      screen.getByRole('button', { name: 'Try saving the calendars again' }),
    )
    await expect.poll(() => desktop.stored.importCalendars).toEqual([])
    await expect.poll(() => work.getAttribute('aria-checked')).toBe('false')
  })

  it('says so when the calendars cannot be read on enable, with retry', async () => {
    // The store is unreadable once, then recovers: the mount reads nothing
    // (permission is still undetermined), so the first read is the enable's.
    const desktop = fakeDesktop({
      stored: {},
      answersPrompt: 'granted',
    })
    let reads = 0
    desktop.calendars = async () => {
      reads += 1
      if (reads === 1) throw new Error('the calendar store is unavailable')
      return [{ id: 'work', title: 'Work', source: 'iCloud' }]
    }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    showFlow(desktop)
    const user = await atTheMeetingImportStep()

    await user.click(importSwitch())

    // An unreadable calendar store refuses the change the way a refused file
    // write does — Import is not left on with nothing to select.
    expect(
      await screen.findByText('Could not change how meetings are imported.'),
    ).toBeTruthy()
    expect(readsOn(importSwitch())).toBe(false)

    await user.click(
      screen.getByRole('button', { name: 'Try saving Import again' }),
    )
    await screen.findByRole('checkbox', { name: /Work/ })
    await expect.poll(() => desktop.stored.importMeetings).toBe(true)
    await expect.poll(() => readsOn(importSwitch())).toBe(true)
  })

  it('shows saved values on Back navigation without resets or re-prompts', async () => {
    const desktop = fakeDesktop({
      stored: {},
      calendars: [{ id: 'work', title: 'Work', source: 'iCloud' }],
    })
    showFlow(desktop)
    const user = await atTheMeetingImportStep()

    await user.click(importSwitch())
    const work = await screen.findByRole('checkbox', { name: /Work/ })
    await user.click(work)
    await expect.poll(() => desktop.stored.importCalendars).toEqual(['work'])
    expect(desktop.prompted).toBe(true)

    // Back is a step of the walk, not a departure: the Start at Login step
    // returns, and coming forward again reads the saved Import back.
    await user.click(screen.getByRole('button', { name: 'Back' }))
    await screen.findByRole('heading', { name: 'Start Work Journal at login?' })
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByRole('heading', {
      name: "Add today's meetings to the journal?",
    })

    await expect.poll(() => readsOn(importSwitch())).toBe(true)
    expect(
      screen
        .getByRole('checkbox', { name: /Work/ })
        .getAttribute('aria-checked'),
    ).toBe('true')
    // Revisiting the step never asks macOS again.
    expect(desktop.prompted).toBe(true)
  })

  it('advances per-step Skip to the finish without rolling back saves', async () => {
    const desktop = fakeDesktop({
      stored: {},
      calendars: [{ id: 'work', title: 'Work', source: 'iCloud' }],
    })
    const { done } = showFlow(desktop)
    const user = await atTheMeetingImportStep()

    await user.click(importSwitch())
    await user.click(await screen.findByRole('checkbox', { name: /Work/ }))
    await expect.poll(() => desktop.stored.importCalendars).toEqual(['work'])

    // Skip this step is the walk advancing, not the flow dismissed early:
    // the finish runs and the saves stand.
    await user.click(screen.getByRole('button', { name: 'Skip this step' }))
    expect(done).toHaveBeenCalledTimes(1)
    expect(desktop.stored.importMeetings).toBe(true)
    expect(desktop.stored.importCalendars).toEqual(['work'])
  })

  it('dismisses the whole flow on Skip onboarding', async () => {
    const desktop = fakeDesktop({ stored: {} })
    const { done } = showFlow(desktop)
    const user = await atTheMeetingImportStep()

    await user.click(screen.getByRole('button', { name: 'Skip onboarding' }))
    expect(done).toHaveBeenCalledTimes(1)
  })
})
