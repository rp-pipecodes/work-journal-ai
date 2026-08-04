import { useCallback, useEffect, useRef, useState } from 'react'
import {
  applyPrediction,
  decideKeystroke,
  markerPrefix,
  type Journal,
  type KeystrokeDecision,
} from '@/journal/journal'
import type { Desktop } from '@/platform/desktop'

/**
 * One line, one keystroke. The window behind this view is created at startup
 * and only ever shown and hidden, so the view resets itself every time the
 * Capture begins rather than relying on a fresh React tree.
 *
 * While a Project Marker is open, Predictions drawn from Projects already on
 * Notes sit under the field. Choosing one fills the marker; typing a new name
 * and committing still works with no list required.
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
  // Offered names for the open marker; empty when the marker is closed is
  // derived below so the effect that loads them never has to clear on close.
  const [offered, setOffered] = useState<string[]>([])
  const [highlight, setHighlight] = useState(0)
  const field = useRef<HTMLInputElement>(null)
  const prefix = markerPrefix(body)
  const predictions = prefix === null ? [] : offered

  const begin = useCallback(() => {
    setBody('')
    setRefusals(0)
    setOffered([])
    setHighlight(0)
    void desktop.fitCapture(0)
    field.current?.focus()
  }, [desktop])

  const dismiss = useCallback(async () => {
    setBody('')
    setRefusals(0)
    setOffered([])
    setHighlight(0)
    void desktop.fitCapture(0)
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

  const choosePrediction = useCallback(
    (name: string) => {
      const next = applyPrediction(name)
      setBody(next)
      setOffered([])
      setHighlight(0)
      void desktop.fitCapture(0)
      // After the fill, the cursor sits ready for the Body.
      requestAnimationFrame(() => {
        const input = field.current
        if (input === null) return
        input.focus()
        input.setSelectionRange(next.length, next.length)
      })
    },
    [desktop],
  )

  useEffect(() => {
    // The page behind the window has to give way to the rounded corners drawn
    // below; only this window's document is marked, since the bundle is shared.
    document.body.classList.add('capture-window')

    // On mount the field is already empty; from here on, every Capture begins
    // with the window being shown.
    field.current?.focus()

    const shown = desktop.onCaptureShown(begin)
    // Clicking away is a discard, not a Capture left floating over the screen.
    const blurred = desktop.onWindowBlurred(() => void dismiss())

    return () => {
      document.body.classList.remove('capture-window')
      void shown.then((stop) => stop())
      void blurred.then((stop) => stop())
    }
  }, [desktop, begin, dismiss])

  useEffect(() => {
    if (prefix === null) {
      void desktop.fitCapture(0)
      return
    }

    let cancelled = false

    void (async () => {
      const names = await (await journal).projectPredictions(prefix)
      if (cancelled) return
      setOffered(names)
      setHighlight(0)
      void desktop.fitCapture(names.length)
    })()

    return () => {
      cancelled = true
    }
  }, [prefix, journal, desktop])

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (predictions.length > 0 && prefix !== null) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setHighlight((index) => (index + 1) % predictions.length)
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setHighlight(
          (index) => (index - 1 + predictions.length) % predictions.length,
        )
        return
      }
      if (event.key === 'Tab') {
        event.preventDefault()
        choosePrediction(predictions[highlight] ?? predictions[0])
        return
      }
      // Enter on a bare marker fills the Prediction rather than committing
      // nothing; once a Body is typed, prefix is null and commit runs as usual.
      if (event.key === 'Enter') {
        event.preventDefault()
        choosePrediction(predictions[highlight] ?? predictions[0])
        return
      }
    }

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
    // The corners are rounded here rather than on the field: the field all but
    // fills the window, so this is the shape the user sees. Predictions sit
    // under the field when a marker is open; the window grows to fit them.
    <div className="flex h-screen flex-col overflow-hidden rounded-2xl border border-border bg-background">
      <input
        ref={field}
        type="text"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={onKeyDown}
        aria-label="What did you just do?"
        placeholder="What did you just do?"
        aria-describedby={refusals > 0 ? PROBLEM_ID : undefined}
        aria-autocomplete="list"
        aria-controls={predictions.length > 0 ? PREDICTIONS_ID : undefined}
        aria-expanded={predictions.length > 0}
        autoComplete="off"
        spellCheck={false}
        // The ring is drawn inside: the field all but fills the window, and an
        // outset one would be clipped by the window's own edge.
        className="h-16 w-full shrink-0 rounded-2xl bg-transparent px-5 text-lg outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40"
      />
      {predictions.length > 0 && (
        <ul
          id={PREDICTIONS_ID}
          role="listbox"
          aria-label="Project Predictions"
          className="flex flex-col border-t border-border"
        >
          {predictions.map((name, index) => (
            <li key={name} role="option" aria-selected={index === highlight}>
              <button
                type="button"
                // mousedown: click would blur the field first and risk a
                // window-blur discard before the choice lands.
                onMouseDown={(event) => {
                  event.preventDefault()
                  choosePrediction(name)
                }}
                className={
                  index === highlight
                    ? 'flex h-8 w-full items-center px-5 text-left text-sm bg-muted'
                    : 'flex h-8 w-full items-center px-5 text-left text-sm hover:bg-muted/60'
                }
              >
                <span className="font-mono text-muted-foreground">#</span>
                {name}
              </button>
            </li>
          ))}
        </ul>
      )}
      {/*
        Under the field rather than in place of it: the window does not resize
        for refusals, so the line takes its room from the field — the Body the
        user is being told about has to stay in sight and stay editable.

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
const PREDICTIONS_ID = 'capture-predictions'

/**
 * What a refused Capture says, in the app's voice rather than the error's. Names
 * what did not happen and what to do about it, because a window that stayed open
 * has already told the user that pressing Enter changed nothing.
 */
const CAPTURE_REFUSED = 'That Note could not be stored. Press Enter to retry.'
