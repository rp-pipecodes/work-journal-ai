// @vitest-environment jsdom

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ThemeProvider from '@/components/ThemeProvider'
import type { CalendarAccess } from '@/platform/desktop'
import {
  deferredStore,
  fakeDesktop,
  type FakeDesktop,
} from '@/platform/testing/desktop'
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

/** Walks the flow to the Model Access step and returns a clicker. */
async function atTheModelAccessStep() {
  const user = await atTheMeetingImportStep()
  await user.click(screen.getByRole('button', { name: 'Continue' }))
  await screen.findByRole('heading', {
    name: 'Write Standup Posts with a model?',
  })
  return user
}

/** The Model Access step's three fields, found the way the user finds them. */
function baseUrlField(): HTMLInputElement {
  return screen.getByLabelText('Base URL') as HTMLInputElement
}

function modelField(): HTMLInputElement {
  return screen.getByLabelText('Model') as HTMLInputElement
}

function apiKeyField(): HTMLInputElement {
  return screen.getByLabelText('API Key') as HTMLInputElement
}

/** The button that hands the typed Key to the Keychain. */
function saveKeyButton(): HTMLElement {
  return screen.getByRole('button', { name: 'Save' })
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
  it('appears after Start at Login and walks on to Model Access', async () => {
    const desktop = fakeDesktop({ stored: {} })
    const { done } = showFlow(desktop)

    const user = await atTheMeetingImportStep()
    expect(done).not.toHaveBeenCalled()

    // Meeting Import is a step of the walk, not the finish: Continue walks
    // on to the Model Access step.
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByRole('heading', { name: 'Write Standup Posts with a model?' })
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

    // A refusal never blocks the journal: continuation walks on to Model
    // Access, the last setup step, and finishing there closes the flow.
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByRole('heading', { name: 'Write Standup Posts with a model?' })
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

    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByRole('heading', { name: 'Write Standup Posts with a model?' })
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

  it('advances per-step Skip to Model Access without rolling back saves', async () => {
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
    // the Model Access step opens and the saves stand.
    await user.click(screen.getByRole('button', { name: 'Skip this step' }))
    await screen.findByRole('heading', { name: 'Write Standup Posts with a model?' })
    expect(done).not.toHaveBeenCalled()
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

  it('builds a tick on the saved selection when the switch was pressed first', async () => {
    // Replay: the file holds Import on with Work ticked, but the read is
    // still landing when the switch is pressed. The press silences only the
    // switch's seed — and the ticks stay hidden until the saved selection is
    // known, so there is no checkbox to build a tick from nothing with. The
    // saved ticks land with the read, and ticking Personal keeps Work
    // instead of dropping it with nothing said.
    const stored: Record<string, unknown> = {
      importMeetings: true,
      importCalendars: ['work'],
    }
    const deferred = deferredStore(stored)
    const desktop = fakeDesktop({
      stored,
      answersPrompt: 'granted',
      calendars: [
        { id: 'work', title: 'Work', source: 'iCloud' },
        { id: 'personal', title: 'Personal', source: 'iCloud' },
      ],
      openSettingsStore: deferred.openSettingsStore,
    })
    showFlow(desktop)
    const user = await atTheMeetingImportStep()

    await user.click(importSwitch())
    // The enablement went through over the granted answer, but the saved
    // selection is not known yet: nothing to tick.
    await expect.poll(() => readsOn(importSwitch())).toBe(true)
    expect(screen.queryByRole('checkbox')).toBeNull()

    deferred.openTheStore()

    // The saved ticks landed despite the earlier press.
    await screen.findByRole('checkbox', { name: /Work/ })
    await user.click(await screen.findByRole('checkbox', { name: /Personal/ }))

    await expect.poll(() => desktop.stored.importCalendars).toEqual([
      'work',
      'personal',
    ])
  })

  it('shows no ticks until the saved selection is known', async () => {
    // Replay with Import on, but the read still landing: there is nothing
    // to tick yet, so no checkbox to build a tick from nothing with. The
    // saved ticks arrive with the read, and ticking builds on them.
    const stored: Record<string, unknown> = {
      importMeetings: true,
      importCalendars: ['work'],
    }
    const deferred = deferredStore(stored)
    const desktop = fakeDesktop({
      stored,
      access: 'granted',
      calendars: [
        { id: 'work', title: 'Work', source: 'iCloud' },
        { id: 'personal', title: 'Personal', source: 'iCloud' },
      ],
      openSettingsStore: deferred.openSettingsStore,
    })
    showFlow(desktop)
    const user = await atTheMeetingImportStep()

    expect(screen.queryByRole('checkbox')).toBeNull()

    deferred.openTheStore()
    await screen.findByRole('checkbox', { name: /Work/ })
    await user.click(await screen.findByRole('checkbox', { name: /Personal/ }))

    await expect.poll(() => desktop.stored.importCalendars).toEqual([
      'work',
      'personal',
    ])
  })

  it('shows the saved choice on Back and Continue while its save is still in flight', async () => {
    // The file takes a while to write: Back and Continue while the enable
    // is still landing must show what was chosen — kept by the flow —
    // rather than re-reading the file mid-save and resetting to off.
    const stored: Record<string, unknown> = {}
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
            await new Promise((resolve) => setTimeout(resolve, 500))
          }
          stored[key] = value
        },
      }),
    })
    showFlow(desktop)
    const user = await atTheMeetingImportStep()

    await user.click(importSwitch())
    // The choice is made — the calendars arrived over the granted answer —
    // but not yet written.
    await screen.findByRole('checkbox', { name: /Work/ })

    await user.click(screen.getByRole('button', { name: 'Back' }))
    await screen.findByRole('heading', { name: 'Start Work Journal at login?' })
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByRole('heading', {
      name: "Add today's meetings to the journal?",
    })

    await expect.poll(() => readsOn(importSwitch())).toBe(true)
    await expect.poll(() => desktop.stored.importMeetings).toBe(true)
  })

  it('says so when the calendars cannot be read on entry, with retry', async () => {
    // Replay with Import saved on and permission granted, but an unreadable
    // calendar store: the switch reads the saved on, yet nothing is
    // promised — the failure is said with a retry, not a configured line.
    const desktop = fakeDesktop({
      stored: { importMeetings: true, importCalendars: ['work'] },
      access: 'granted',
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

    await expect.poll(() => readsOn(importSwitch())).toBe(true)
    expect(
      await screen.findByText('Could not read your calendars.'),
    ).toBeTruthy()
    expect(screen.queryByText(/will be imported/)).toBeNull()

    await user.click(
      screen.getByRole('button', { name: 'Try reading the calendars again' }),
    )
    await screen.findByRole('checkbox', { name: /Work/ })
    expect(
      await screen.findByText(/meetings from Work will be imported/),
    ).toBeTruthy()
  })

  it('says selected calendars are unavailable instead of promising Import', async () => {
    // The saved ticks resolve to nothing macOS holds: stale identifiers must
    // not produce the configured line.
    const desktop = fakeDesktop({
      stored: { importMeetings: true, importCalendars: ['gone'] },
      access: 'granted',
      calendars: [{ id: 'work', title: 'Work', source: 'iCloud' }],
    })
    showFlow(desktop)
    await atTheMeetingImportStep()

    expect(
      await screen.findByText(/no longer available/),
    ).toBeTruthy()
    expect(screen.queryByText(/will be imported/)).toBeNull()
  })

  it('says there is nothing to tick when no calendars exist, with a way to check again', async () => {
    const desktop = fakeDesktop({
      stored: {},
      access: 'granted',
      calendars: [],
    })
    showFlow(desktop)
    const user = await atTheMeetingImportStep()

    await user.click(importSwitch())
    await screen.findByText('No calendars to read.')

    // Genuinely zero calendars is guidance of its own — not the instruction
    // to tick, which would point at nothing.
    expect(await screen.findByText(/Nothing to tick/)).toBeTruthy()
    expect(
      screen.queryByText(/Tick the calendars that mean work/),
    ).toBeNull()

    // A calendar added since is one check away.
    desktop.calendars = async () => [
      { id: 'work', title: 'Work', source: 'iCloud' },
    ]
    await user.click(
      screen.getByRole('button', { name: 'Check for calendars again' }),
    )
    await screen.findByRole('checkbox', { name: /Work/ })
    expect(
      await screen.findByText(/permission alone imports nothing/),
    ).toBeTruthy()
  })

  it('keeps one status region whose content swaps', async () => {
    const desktop = fakeDesktop({
      stored: {},
      calendars: [{ id: 'work', title: 'Work', source: 'iCloud' }],
    })
    showFlow(desktop)
    const user = await atTheMeetingImportStep()

    // Here before there is anything configured to say, so configuring it is
    // announced rather than merely appearing.
    expect(screen.getAllByRole('status')).toHaveLength(1)

    await user.click(importSwitch())
    await user.click(await screen.findByRole('checkbox', { name: /Work/ }))
    await screen.findByText(/meetings from Work will be imported/)

    expect(screen.getAllByRole('status')).toHaveLength(1)
  })

  it('asks macOS once when the switch is pressed twice in the gap', async () => {
    const desktop = fakeDesktop({ stored: {} })
    let prompts = 0
    let release!: (access: CalendarAccess) => void
    const held = new Promise<CalendarAccess>((resolve) => {
      release = resolve
    })
    desktop.requestCalendarAccess = async () => {
      prompts += 1
      desktop.prompted = true
      return held
    }
    showFlow(desktop)
    await atTheMeetingImportStep()

    // Two presses while macOS is still answering: the second lands on a
    // disabled switch and through the in-flight guard alike. (Base UI
    // renders the switch as a span, so disabled reads as data-disabled.)
    const control = importSwitch()
    control.click()
    control.click()
    await expect.poll(() => control.hasAttribute('data-disabled')).toBe(true)

    release('granted')
    await expect.poll(() => desktop.stored.importMeetings).toBe(true)
    await expect.poll(() => readsOn(importSwitch())).toBe(true)
    expect(prompts).toBe(1)
  })
})

describe('the Model Access step', () => {
  it('is the last setup step: it follows Meeting Import and finishes in History', async () => {
    const desktop = fakeDesktop({ stored: {} })
    const { done } = showFlow(desktop)

    const user = await atTheModelAccessStep()

    // The last optional setup step finishes the flow directly: Open History
    // is the finish, not an extra completion screen.
    await user.click(screen.getByRole('button', { name: 'Open History' }))
    expect(done).toHaveBeenCalledTimes(1)
  })

  it('asks macOS for nothing and sends nothing on entering or finishing', async () => {
    // Entering and finishing make no calendar prompt and no model request:
    // nothing is sent until a Standup Post is explicitly asked for.
    const desktop = fakeDesktop({ stored: {} })
    const { done } = showFlow(desktop)
    const user = await atTheModelAccessStep()

    expect(desktop.prompted).toBe(false)
    expect(desktop.standupRequests).toEqual([])

    await user.click(screen.getByRole('button', { name: 'Open History' }))
    expect(done).toHaveBeenCalledTimes(1)
    expect(desktop.standupRequests).toEqual([])
  })

  it('saves the Base URL, the Model and the API Key through the existing settings', async () => {
    const desktop = fakeDesktop({ stored: {} })
    showFlow(desktop)
    const user = await atTheModelAccessStep()

    // The two ordinary fields save on every keystroke, exactly as in
    // Settings; the Key is saved by its button and lands in the Keychain,
    // never in the settings file and never back in the window.
    fireEvent.change(baseUrlField(), {
      target: { value: 'http://localhost:11434/v1' },
    })
    fireEvent.change(modelField(), { target: { value: 'llama3.1' } })
    await expect.poll(() => desktop.stored.modelBaseUrl).toBe(
      'http://localhost:11434/v1',
    )
    expect(desktop.stored.model).toBe('llama3.1')

    fireEvent.change(apiKeyField(), { target: { value: 'sk-a-real-key' } })
    await user.click(saveKeyButton())

    await expect.poll(() => desktop.apiKey).toBe('sk-a-real-key')
    expect(Object.values(desktop.stored)).not.toContain('sk-a-real-key')
    await expect.poll(() => apiKeyField().value).toBe('')
    expect(document.body.textContent).not.toContain('sk-a-real-key')
  })

  it('distinguishes off, partial and configured states without claiming the endpoint was tried', async () => {
    const desktop = fakeDesktop({ stored: {} })
    showFlow(desktop)
    const user = await atTheModelAccessStep()

    // Nothing of the user's is there yet: Model Access is off, and the
    // journal is said to work without it.
    expect(await screen.findByText(/Model Access is off/)).toBeTruthy()

    // A Model alone is partial: the step names the missing part rather than
    // pretending the endpoint is reachable.
    fireEvent.change(modelField(), { target: { value: 'llama3.1' } })
    expect(
      await screen.findByText(/add an API Key/),
    ).toBeTruthy()

    fireEvent.change(apiKeyField(), { target: { value: 'sk-a-real-key' } })
    await user.click(saveKeyButton())

    // Configured, and plainly unverified: saving is not a connection test.
    expect(
      await screen.findByText(/set to ask llama3\.1/),
    ).toBeTruthy()
    expect(screen.getByText(/has not been tried/)).toBeTruthy()
    expect(screen.queryByText(/connected|reachable|verified working/)).toBeNull()
  })

  it('shows saved answers on Back without resetting choices or exposing the secret', async () => {
    const desktop = fakeDesktop({ stored: {} })
    let keychainAsks = 0
    const ask = desktop.apiKeySet.bind(desktop)
    desktop.apiKeySet = async () => {
      keychainAsks += 1
      return ask()
    }
    showFlow(desktop)
    const user = await atTheModelAccessStep()

    fireEvent.change(baseUrlField(), {
      target: { value: 'http://localhost:11434/v1' },
    })
    fireEvent.change(modelField(), { target: { value: 'llama3.1' } })
    fireEvent.change(apiKeyField(), { target: { value: 'sk-a-real-key' } })
    await user.click(saveKeyButton())
    await expect.poll(() => desktop.apiKey).toBe('sk-a-real-key')
    const asksAfterSaving = keychainAsks

    // Back is a step of the walk, not a reset: returning to the step shows
    // what was just saved, and asks the Keychain nothing again.
    await user.click(screen.getByRole('button', { name: 'Back' }))
    await screen.findByRole('heading', {
      name: "Add today's meetings to the journal?",
    })
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByRole('heading', { name: 'Write Standup Posts with a model?' })

    await expect.poll(() => baseUrlField().value).toBe(
      'http://localhost:11434/v1',
    )
    expect(modelField().value).toBe('llama3.1')
    expect(await screen.findByText(/A key is saved/)).toBeTruthy()
    expect(document.body.textContent).not.toContain('sk-a-real-key')
    expect(keychainAsks).toBe(asksAfterSaving)
  })

  it('reads saved answers back on replay without exposing the secret', async () => {
    const desktop = fakeDesktop({
      stored: {
        modelBaseUrl: 'https://example.test/v1',
        model: 'gpt-test',
      },
      apiKey: 'sk-from-an-earlier-run',
    })
    showFlow(desktop)
    await atTheModelAccessStep()

    await expect.poll(() => baseUrlField().value).toBe('https://example.test/v1')
    expect(modelField().value).toBe('gpt-test')
    await expect.poll(() => apiKeyField().value).toBe('')
    expect(await screen.findByText(/A key is saved/)).toBeTruthy()
    expect(document.body.textContent).not.toContain('sk-from-an-earlier-run')
  })

  it('says a refused field save, with a retry that saves the current text', async () => {
    const stored: Record<string, unknown> = {}
    // The file takes the first Model write and refuses it.
    let modelWrites = 0
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
          if (key === 'model') {
            modelWrites += 1
            if (modelWrites === 1) throw new Error('the file is read-only')
          }
          stored[key] = value
        },
      }),
    })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    showFlow(desktop)
    const user = await atTheModelAccessStep()

    fireEvent.change(modelField(), { target: { value: 'llama3.1' } })

    // The refused field is named, and nothing claims it was saved.
    expect(
      await screen.findByText(/Model could not be saved/),
    ).toBeTruthy()
    expect(stored.model).toBeUndefined()

    // The retry is the current text saved afresh: it takes, and the refusal
    // goes away with it.
    await user.click(
      screen.getByRole('button', { name: 'Try saving the Model again' }),
    )
    await expect.poll(() => stored.model).toBe('llama3.1')
    await expect.poll(() => screen.queryByText(/could not be saved/)).toBeNull()
  })

  it('says why a refusing Keychain is refusing, and offers a retry that recovers', async () => {
    // The Keychain refuses the mount read: the step says why, in the
    // Keychain's own words, and offers to ask again.
    const desktop = fakeDesktop({ stored: {}, keychainRefuses: true })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    showFlow(desktop)
    const user = await atTheModelAccessStep()

    expect(
      await screen.findByText(/the keychain could not be reached/),
    ).toBeTruthy()
    // Nothing claims to know whether a key is saved while it will not say.
    expect(document.body.textContent).not.toContain('A key is saved')

    desktop.keychainRefuses = false
    await user.click(
      screen.getByRole('button', { name: 'Try reading the API Key status again' }),
    )

    await expect.poll(() => screen.queryByRole('alert')).toBeNull()
    expect(await screen.findByText(/No key is saved/)).toBeTruthy()
  })

  it('keeps the typed Key through a refused save, and lets the retry land it', async () => {
    // The mount read answers (no key), then the Keychain shuts as Save is
    // pressed: the refused key stays under the cursor — it is still the
    // user's, on its way out — and the retry behaves like the press again.
    const desktop = fakeDesktop({ stored: {} })
    showFlow(desktop)
    const user = await atTheModelAccessStep()

    await screen.findByText(/No key is saved/)
    desktop.keychainRefuses = true
    fireEvent.change(apiKeyField(), { target: { value: 'sk-a-real-key' } })
    await user.click(saveKeyButton())

    expect(
      await screen.findByText(/the keychain could not be reached/),
    ).toBeTruthy()
    expect(desktop.apiKey).toBe(null)
    expect(apiKeyField().value).toBe('sk-a-real-key')

    desktop.keychainRefuses = false
    await user.click(
      screen.getByRole('button', { name: 'Try saving the API Key again' }),
    )

    await expect.poll(() => desktop.apiKey).toBe('sk-a-real-key')
    await expect.poll(() => screen.queryByRole('alert')).toBeNull()
    await expect.poll(() => apiKeyField().value).toBe('')
  })

  it('can clear a key the Keychain holds', async () => {
    const desktop = fakeDesktop({ stored: {}, apiKey: 'sk-from-an-earlier-run' })
    showFlow(desktop)
    const user = await atTheModelAccessStep()

    await screen.findByText(/A key is saved/)
    await user.click(screen.getByRole('button', { name: 'Clear' }))

    await expect.poll(() => desktop.apiKey).toBe(null)
    await screen.findByText(/No key is saved/)
  })

  it('tells a returned user to type the Key again, instead of a retry that saves nothing', async () => {
    // The refusal is kept across Back and Continue, but the typed Key is not:
    // a Try again on the way back would save an empty field forever, so the
    // step says what to do instead.
    const desktop = fakeDesktop({ stored: {} })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    showFlow(desktop)
    const user = await atTheModelAccessStep()

    await screen.findByText(/No key is saved/)
    desktop.keychainRefuses = true
    fireEvent.change(apiKeyField(), { target: { value: 'sk-a-real-key' } })
    await user.click(saveKeyButton())
    expect(
      await screen.findByText(/the keychain could not be reached/),
    ).toBeTruthy()
    desktop.keychainRefuses = false

    // Back drops the typed Key, and Continue brings the refusal back.
    await user.click(screen.getByRole('button', { name: 'Back' }))
    await screen.findByRole('heading', {
      name: "Add today's meetings to the journal?",
    })
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByRole('heading', { name: 'Write Standup Posts with a model?' })

    expect(
      await screen.findByText(/the keychain could not be reached/),
    ).toBeTruthy()
    expect(
      screen.queryByRole('button', { name: 'Try saving the API Key again' }),
    ).toBeNull()
    expect(await screen.findByText(/type it again/)).toBeTruthy()

    // Typing the Key again and pressing Save is what retries it.
    fireEvent.change(apiKeyField(), { target: { value: 'sk-a-real-key' } })
    await user.click(saveKeyButton())
    await expect.poll(() => desktop.apiKey).toBe('sk-a-real-key')
    await expect.poll(() => apiKeyField().value).toBe('')
  })

  it('re-reads the file when the step was left before its first read landed', async () => {
    // Back in the gap between the step opening and the file answering must
    // not let the earlier mount mark its unread answers as read: returning
    // reads the saved values rather than resuming nothing.
    const stored: Record<string, unknown> = {
      modelBaseUrl: 'https://example.test/v1',
      model: 'gpt-test',
    }
    const deferred = deferredStore(stored)
    const desktop = fakeDesktop({
      stored,
      openSettingsStore: deferred.openSettingsStore,
    })
    showFlow(desktop)
    await atTheModelAccessStep()

    // The file is still answering: leave before it does.
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    await screen.findByRole('heading', {
      name: "Add today's meetings to the journal?",
    })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByRole('heading', { name: 'Write Standup Posts with a model?' })

    // The returning mount re-reads, so the saved answers arrive — they are
    // not skipped as if this mount had already read them.
    deferred.openTheStore()
    await expect.poll(() => baseUrlField().value).toBe('https://example.test/v1')
    expect(modelField().value).toBe('gpt-test')
  })

  it('says a Base URL the Key may not travel over is needs-attention, not configured', async () => {
    // A plaintext non-loopback Base URL is refused where the Key would be
    // attached, so a step that claimed it was configured would promise a call
    // the app refuses. The status line applies the same rule.
    const desktop = fakeDesktop({
      stored: {
        modelBaseUrl: 'http://api.example.com/v1',
        model: 'gpt-test',
      },
      apiKey: 'sk-from-an-earlier-run',
    })
    showFlow(desktop)
    await atTheModelAccessStep()

    expect(
      await screen.findByText(/cannot travel to http:\/\/api\.example\.com/),
    ).toBeTruthy()
    expect(screen.queryByText(/set to ask/)).toBeNull()

    // Plaintext to this Mac's own loopback is allowed, so the same three
    // parts read as configured once the Base URL points there.
    fireEvent.change(baseUrlField(), {
      target: { value: 'http://localhost:11434/v1' },
    })
    expect(await screen.findByText(/set to ask gpt-test/)).toBeTruthy()
  })

  it('finishes with per-step Skip, and dismisses the whole flow on Skip onboarding', async () => {
    const desktop = fakeDesktop({ stored: {} })
    const { done } = showFlow(desktop)
    const user = await atTheModelAccessStep()

    // Per-step Skip on the last setup step is the walk finishing.
    await user.click(screen.getByRole('button', { name: 'Skip this step' }))
    expect(done).toHaveBeenCalledTimes(1)
  })

  it('dismisses the whole flow on Skip onboarding without saving anything', async () => {
    const desktop = fakeDesktop({ stored: {} })
    const { done } = showFlow(desktop)
    const user = await atTheModelAccessStep()

    await user.click(screen.getByRole('button', { name: 'Skip onboarding' }))
    expect(done).toHaveBeenCalledTimes(1)
    expect(desktop.standupRequests).toEqual([])
  })
})
