// @vitest-environment jsdom

import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { toast } from 'sonner'
import OnScreenContext from '@/components/on-screen-context'
import { fakeDesktop, type FakeDesktop } from '@/platform/testing/desktop'
import { holdFrames } from './testing/frames'
import UpdateSettings from './UpdateSettings'

// The one thing about this group the Main Window seam cannot show: what
// happens in the gap between the commit that hides Settings and React getting
// round to the cleanup that belongs to it. Measured rather than assumed — a
// commit lands one macrotask before a passive effect does, and a frame coming
// due in between is a browser doing nothing unusual.

afterEach(() => {
  cleanup()
  toast.dismiss()
  vi.restoreAllMocks()
})

/**
 * The update group under a visibility this test can change the slow way. The
 * hide is made from outside a React event on purpose: a click would be a
 * discrete update, which React commits and flushes in one breath, and it is
 * the unhurried path — the Tray Menu naming a section — that leaves a gap.
 */
function showUpdates(desktop: FakeDesktop): { hide: () => void } {
  const control: { hide: () => void } = {
    hide: () => {
      throw new Error('The group has not rendered yet.')
    },
  }

  function Host() {
    const [onScreen, setOnScreen] = useState(true)
    control.hide = () => setOnScreen(false)

    return (
      <div data-testid="section" hidden={!onScreen}>
        <OnScreenContext.Provider value={onScreen}>
          <UpdateSettings desktop={desktop} />
        </OnScreenContext.Provider>
      </div>
    )
  }

  render(<Host />)
  return control
}

/** One macrotask: long enough for a commit to land, short enough to beat the
 * passive effects React scheduled behind it. */
function aTick(): Promise<void> {
  return new Promise((settle) => setTimeout(settle, 0))
}

it('cancels the restart in the commit that hides Settings, not a tick later', async () => {
  const desktop = fakeDesktop({ stored: { startAtLogin: false } })
  desktop.availableUpdate = { version: '0.9.0' }
  const frames = holdFrames()

  try {
    const { hide } = showUpdates(desktop)

    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Install 0.9.0' }))
    await screen.findByRole('button', { name: 'Restarting…' })
    expect(frames.pending()).toBeGreaterThan(0)

    // The section switch lands. One tick on, the DOM already hides Settings.
    hide()
    await aTick()
    expect(screen.getByTestId('section').hidden).toBe(true)

    // A frame comes due here — after the hide, before React has run a single
    // passive effect. Nothing may restart: the user is looking at another
    // section, whether or not React has caught up with them.
    frames.drain()

    expect(desktop.restarts).toBe(0)
  } finally {
    frames.restore()
  }
})
