import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { decideKeystroke, type KeystrokeDecision } from '@/journal/journal'
import { journal } from '@/journal/tauri-journal'

/** Must match `CAPTURE_SHOWN_EVENT` in `src-tauri/src/lib.rs`. */
const CAPTURE_SHOWN_EVENT = 'capture://shown'

/**
 * One line, one keystroke. The window behind this view is created at startup
 * and only ever shown and hidden, so the view resets itself every time the
 * Capture begins rather than relying on a fresh React tree.
 */
export default function CaptureView() {
  const [body, setBody] = useState('')
  const field = useRef<HTMLInputElement>(null)

  const begin = useCallback(() => {
    setBody('')
    field.current?.focus()
  }, [])

  // Hiding the window is the Rust side's job: it also has to hand focus back to
  // the application the Capture interrupted.
  const dismiss = useCallback(async () => {
    setBody('')
    await invoke('dismiss_capture')
  }, [])

  const commit = useCallback(
    async (text: string) => {
      try {
        await (await journal()).capture(text)
      } catch (error) {
        // A Capture that could not be stored must not vanish: leave the window
        // open with the text still in it rather than discarding the thought.
        console.error('could not commit the Note', error)
        return
      }
      await dismiss()
    },
    [dismiss],
  )

  useEffect(() => {
    // On mount the field is already empty; from here on, every Capture begins
    // with the window being shown.
    field.current?.focus()

    const shown = listen(CAPTURE_SHOWN_EVENT, begin)
    // Clicking away is a discard, not a Capture left floating over the screen.
    const blurred = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (!focused) {
        void dismiss()
      }
    })

    return () => {
      void shown.then((stop) => stop())
      void blurred.then((stop) => stop())
    }
  }, [begin, dismiss])

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
      placeholder="What did you just do?"
      autoComplete="off"
      spellCheck={false}
      className="h-16 w-full bg-background px-5 text-lg outline-none"
    />
  )
}
