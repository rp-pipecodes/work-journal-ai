// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import WindowTitleBar from './WindowTitleBar'

// The strip the traffic lights sit in, and the one thing it does besides
// stand out of their way: it drags the window.

afterEach(cleanup)

/** The strip, as the windows that carry it render it. */
function strip(): HTMLElement {
  const { container } = render(<WindowTitleBar />)
  const found = container.firstElementChild
  if (!(found instanceof HTMLElement)) throw new Error('nothing was rendered')
  return found
}

describe('the strip', () => {
  it('drags the window when it is pressed', () => {
    // The window used to be dragged by the title bar macOS draws underneath,
    // which stops hearing the mouse once the webview has been clicked into.
    // The strip asks for the drag itself, so it never stops working.
    expect(strip().querySelector('[data-tauri-drag-region]')).not.toBeNull()
  })

  it("leaves the traffic lights' corner alone", () => {
    // A drag region drawn over the buttons is a drag region that swallows the
    // press meant to close the window.
    const dragged = strip().querySelector('[data-tauri-drag-region]')
    const corner = dragged?.previousElementSibling
    expect(corner).not.toBeNull()
    expect(corner?.hasAttribute('data-tauri-drag-region')).toBe(false)
  })
})
