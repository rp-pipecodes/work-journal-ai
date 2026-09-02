/**
 * The animation frames a view asks for, held rather than run. jsdom paints
 * nothing and runs frames off a timer, so a test that wants to say anything
 * about what happens between one frame and the next has to own them.
 *
 * Held frames also widen the moment a race lives in: whatever the test does
 * between `hold()` and `drain()` happens, as far as the view is concerned,
 * inside the gap between the install and the paint.
 */
export interface HeldFrames {
  /** How many callbacks are waiting — 0 once they have been cancelled. */
  pending(): number
  /** Runs the one waiting, as a browser would at a paint. */
  next(): void
  /**
   * Runs frames until none is left. Drained rather than iterated over a
   * snapshot: a frame callback commonly asks for the next one, and a snapshot
   * taken up front would never reach it — which is a test proving nothing.
   */
  drain(): void
  /** Puts the real frames back. Always call this from a `finally`. */
  restore(): void
}

export function holdFrames(): HeldFrames {
  const queued = new Map<number, FrameRequestCallback>()
  let asked = 0
  const realRequest = window.requestAnimationFrame
  const realCancel = window.cancelAnimationFrame

  window.requestAnimationFrame = ((run: FrameRequestCallback) => {
    asked += 1
    queued.set(asked, run)
    return asked
  }) as typeof window.requestAnimationFrame

  window.cancelAnimationFrame = ((frame: number) => {
    queued.delete(frame)
  }) as typeof window.cancelAnimationFrame

  function runOne(): boolean {
    const waiting = [...queued.entries()][0]
    if (waiting === undefined) return false
    const [asked, run] = waiting
    queued.delete(asked)
    run(0)
    return true
  }

  return {
    pending: () => queued.size,
    next() {
      if (!runOne()) throw new Error('No frame was asked for.')
    },
    drain() {
      // Bounded, so a view that rescheduled forever fails rather than hangs.
      for (let frame = 0; frame < 10 && runOne(); frame += 1);
    },
    restore() {
      window.requestAnimationFrame = realRequest
      window.cancelAnimationFrame = realCancel
    },
  }
}
