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
  render(
    <ThemeProvider settings={settings}>
      <OnboardingView desktop={desktop} settings={settings} onDone={done} />
    </ThemeProvider>,
  )
  return { done }
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
