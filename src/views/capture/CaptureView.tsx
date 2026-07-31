import { useCallback, useEffect, useRef, useState } from 'react'
import {
  decideKeystroke,
  type Journal,
  type KeystrokeDecision,
} from '@/journal/journal'
import type { Desktop } from '@/platform/desktop'

/**
 * One line, one keystroke. The window behind this view is created at startup
 * and only ever shown and hidden, so the view resets itself every time the
 * Capture begins rather than relying on a fresh React tree.
 */
export default function CaptureView({
  desktop,
  journal,
}: {
  desktop: Desktop
  journal: Promise<Journal>
}) {
  const [body, setBody] = useState('')
  const field = useRef<HTMLInputElement>(null)

  const begin = useCallback(() => {
    setBody('')
    field.current?.focus()
  }, [])

  const dismiss = useCallback(async () => {
    setBody('')
    await desktop.dismissCapture()
  }, [desktop])

  const commit = useCallback(
    async (text: string) => {
      let note
      try {
        note = await (await journal).capture(text)
      } catch (error) {
        // A Capture that could not be stored must not vanish: leave the window
        // open with the text still in it rather than discarding the thought.
        console.error('could not commit the Note', error)
        return
      }

      // A history window on screen has no other way to learn of the Note, and
      // the announcement has to leave before the window goes — dismissing hides
      // the whole app. It failing is not the Capture's problem: the Note is
      // stored either way.
      if (note !== null) {
        try {
          await desktop.announceCapturedNote(note.journalDay)
        } catch (error) {
          console.error('could not announce the Note', error)
        }
      }

      await dismiss()
    },
    [desktop, journal, dismiss],
  )

  useEffect(() => {
    // On mount the field is already empty; from here on, every Capture begins
    // with the window being shown.
    field.current?.focus()

    const shown = desktop.onCaptureShown(begin)
    // Clicking away is a discard, not a Capture left floating over the screen.
    const blurred = desktop.onWindowBlurred(() => void dismiss())

    return () => {
      void shown.then((stop) => stop())
      void blurred.then((stop) => stop())
    }
  }, [desktop, begin, dismiss])

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    void act(decideKeystroke(event.key, body))
  }

  async function act(decision: KeystrokeDecision) {
    if (decision === 'commit') {
      await commit(body)
    } else if (decision === 'discard') {
      await dismiss()
    }
  }

  return (
    <input
      ref={field}
      type="text"
      value={body}
      onChange={(event) => setBody(event.target.value)}
      onKeyDown={onKeyDown}
      aria-label="What did you just do?"
      placeholder="What did you just do?"
      autoComplete="off"
      spellCheck={false}
      // The ring is drawn inside: this field is the whole window, and an
      // outset one would be clipped by the window's own edge.
      className="h-16 w-full bg-background px-5 text-lg outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40"
    />
  )
}
