import { useEffect, useMemo, useRef } from 'react'
import { toast } from 'sonner'

import { useOffScreen, useOnScreen } from './on-screen-context'

/**
 * The messages a view says, raised only while it is the view on screen.
 *
 * Sonner keeps one list of messages for the whole document and every mounted
 * Toaster draws all of it, so a message belongs to no view: it is drawn by
 * whichever Toaster is showing, which in the Main Window is the Toaster of the
 * section the user switched to. Hiding the section that raised it therefore
 * does not take it away, and a message raised after leaving — the confirmation
 * of a copy or an export that finished while the user was already somewhere
 * else — is said over a section that never asked anything.
 *
 * So a view says nothing while it is not on screen, and what it has already
 * said goes when it does: what a message confirms has still happened, and the
 * view keeps saying it where it does not fade — the line under the button, the
 * list that now reads differently. See
 * docs/adr/0024-a-view-is-told-whether-it-is-on-screen.md.
 */
export function useOnScreenToast(): OnScreenToast {
  const onScreen = useOnScreen()
  // Read as the message is raised rather than as this renders: the raise comes
  // out of work that was already in flight when the user left, and it is where
  // they are now that decides whether anything is said.
  const showing = useRef(onScreen)
  useEffect(() => {
    showing.current = onScreen
  }, [onScreen])

  useOffScreen(() => toast.dismiss())

  return useMemo(
    () => ({
      say: (message) => {
        if (showing.current) toast(message)
      },
      success: (message) => {
        if (showing.current) toast.success(message)
      },
      failure: (message) => {
        if (showing.current) toast.error(message)
      },
    }),
    [],
  )
}

/** What a view can say, in the three shapes it says things in. */
export type OnScreenToast = {
  /** Something that happened, stated plainly. */
  say: (message: string) => void
  /** Something the user asked for, which worked. */
  success: (message: string) => void
  /** Something the user asked for, which did not. */
  failure: (message: string) => void
}
