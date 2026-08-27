import { createContext, useContext, useEffect, useRef } from 'react'

/**
 * Whether what is being rendered is on screen — asked by a view that has put
 * something there, and answered by whoever is showing or hiding it.
 *
 * A window is on screen by default: a view rendered by a window of its own has
 * nobody hiding it, and nothing to ask. What makes the question worth asking is
 * a host that keeps more than one view mounted and shows one of them, because
 * hiding an element hides only what it holds — a dialog, a popup, a menu is
 * portalled to the end of the document, where it stays on screen over whatever
 * is showing. A view is the only thing that knows what it put out there and
 * what dropping it costs, so the answer is all this hands over.
 */
const OnScreenContext = createContext(true)

export default OnScreenContext

/** Whether the view asking is the one on screen. */
export function useOnScreen(): boolean {
  return useContext(OnScreenContext)
}

/**
 * Called when the view is not on screen: the moment it leaves, and once on
 * mount if it was mounted off screen to begin with — which is what a Main
 * Window opened on another section does to the other two. So `take` says what
 * the view has on screen that it should not, and dropping what is not there is
 * expected to cost nothing.
 *
 * State the view means to come back to — a Filter, a half-typed edit, a
 * question still unanswered — is not this: it is kept, and only what it draws
 * is dropped.
 */
export function useOffScreen(take: () => void): void {
  const onScreen = useOnScreen()
  // The latest one, so a handler written inline does not run this every
  // render — going off screen is what runs it, and nothing else.
  const latest = useRef(take)
  useEffect(() => {
    latest.current = take
  })

  useEffect(() => {
    if (!onScreen) latest.current()
  }, [onScreen])
}
