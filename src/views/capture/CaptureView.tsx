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
  // How many times this Capture has been refused. Zero until one is, and zero
  // again when the next Capture begins — a window that stayed open claims
  // nothing on its own. Counted rather than flagged so a second refusal is a
  // second thing on screen: the message invites another Enter, and one that
  // changed nothing would read as the silence it replaced.
  const [refusals, setRefusals] = useState(0)
  const field = useRef<HTMLInputElement>(null)

  const begin = useCallback(() => {
    setBody('')
    setRefusals(0)
    field.current?.focus()
  }, [])

  const dismiss = useCallback(async () => {
    setBody('')
    setRefusals(0)
    await desktop.dismissCapture()
  }, [desktop])

  const commit = useCallback(
    async (text: string) => {
      let note
      try {
        note = await (await journal).capture(text)
      } catch (error) {
        // A Capture that could not be stored must not vanish: leave the window
        // open with the Body still in it rather than discarding the thought —
        // and say so, since a window that merely stayed open reads as a missed
        // keystroke.
        console.error('could not commit the Note', error)
        setRefusals((refused) => refused + 1)
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
    <div className="flex h-screen flex-col bg-background">
      <input
        ref={field}
        type="text"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={onKeyDown}
        aria-label="What did you just do?"
        placeholder="What did you just do?"
        aria-describedby={refusals > 0 ? PROBLEM_ID : undefined}
        autoComplete="off"
        spellCheck={false}
        // The ring is drawn inside: the field all but fills the window, and an
        // outset one would be clipped by the window's own edge.
        className="min-h-0 w-full flex-1 bg-transparent px-5 text-lg outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40"
      />
      {/*
        Under the field rather than in place of it: the window does not resize,
        so the line takes its room from the field — the Body the user is being
        told about has to stay in sight and stay editable.

        Keyed by the count so each refusal is a new node: a repeated one is then
        announced again rather than passing as the same message still sitting
        there.
      */}
      {refusals > 0 && (
        <p
          key={refusals}
          id={PROBLEM_ID}
          role="alert"
          className="shrink-0 px-5 pb-2 text-xs text-destructive"
        >
          {CAPTURE_REFUSED}
        </p>
      )}
    </div>
  )
}

const PROBLEM_ID = 'capture-problem'

/**
 * What a refused Capture says, in the app's voice rather than the error's. Names
 * what did not happen and what to do about it, because a window that stayed open
 * has already told the user that pressing Enter changed nothing.
 */
const CAPTURE_REFUSED = 'That Note could not be stored. Press Enter to retry.'
