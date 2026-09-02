import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  isThemeToggle,
  resolveTheme,
  toggledTheme,
  DEFAULT_THEME,
  type Theme,
} from '@/settings/theme'
import type { AppSettings } from '@/settings/app-settings'
import { ThemeContext } from './theme-context'

/** The one class `src/index.css` paints a dark palette from. */
const DARK_CLASS = 'dark'

/**
 * Puts the Theme on the document, and keeps it there. Every window loads the
 * same bundle and so mounts its own copy: the preference is stored once and
 * announced to all of them, so a toggle pressed in Settings reaches the Capture
 * window too.
 *
 * Outside Tauri — a bare `vite dev` — there is no store to read, so the app
 * follows the OS for the run and forgets any toggle when the page reloads.
 */
export default function ThemeProvider({
  settings,
  children,
}: {
  settings: AppSettings
  children: React.ReactNode
}) {
  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME)
  const [prefersDark, setPrefersDark] = useState(systemPrefersDark)
  // Until the stored preference has been read, the palette already on the
  // document is better than the one this component would work out: `index.html`
  // put it there from what the Rust side knew, and `DEFAULT_THEME` is only a
  // guess standing in for an answer that is still on its way. Repainting from
  // the guess is exactly the blink this is here to avoid.
  const [known, setKnown] = useState(false)

  useEffect(() => {
    let current = true
    // A store that cannot be read is not worth failing the window over: the
    // default follows the OS, which is what an unasked user gets anyway.
    void settings
      .loadTheme()
      .then((stored) => {
        if (current) {
          setTheme(stored)
        }
      })
      .catch((error: unknown) => {
        console.error('could not read the Theme', error)
      })
      .finally(() => {
        // Either way there is nothing further to wait for: a store that stayed
        // silent has still had its say.
        if (current) {
          setKnown(true)
        }
      })

    const changed = settings
      .onThemeChanged((announced) => {
        // Another window's user has settled it, which is an answer too.
        setTheme(announced)
        setKnown(true)
      })
      .catch((error: unknown) => {
        console.error('could not follow the Theme', error)
        return null
      })

    return () => {
      current = false
      void changed.then((stop) => stop?.())
    }
  }, [settings])

  // The OS palette can change under a window that is following it.
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const follow = (event: MediaQueryListEvent) => setPrefersDark(event.matches)
    query.addEventListener('change', follow)
    return () => query.removeEventListener('change', follow)
  }, [])

  const resolved = resolveTheme(theme, prefersDark)

  useEffect(() => {
    if (!known) {
      return
    }
    const root = document.documentElement
    root.classList.toggle(DARK_CLASS, resolved === 'dark')
    // So that form controls and scrollbars the app does not style are painted
    // to match rather than staying stubbornly light.
    root.style.colorScheme = resolved
  }, [resolved, known])

  const ask = useCallback(
    (next: Theme) => {
      // Applied here rather than waited for: the announcement is how the
      // *other* windows find out, and a store that cannot be written must
      // still repaint the window whose user asked for it.
      setTheme(next)
      // A Theme the user asked for outranks one still being read off the disk,
      // so a toggle pressed in the first moments repaints rather than waiting.
      setKnown(true)
      // The write is the caller's to describe, not this provider's — it hands
      // the promise back, rejection and all. A caller that ignores it must
      // still leave the rejection heard, so the log is attached beside the
      // caller rather than in front of it: a catch here that swallowed the
      // error would turn the failure into a success for whoever is listening.
      const saving = settings.saveTheme(next)
      saving.catch((error: unknown) => {
        console.error('could not remember the Theme', error)
      })
      return saving
    },
    [settings],
  )

  const toggle = useCallback(() => {
    ask(toggledTheme(theme, prefersDark))
  }, [ask, theme, prefersDark])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (isThemeToggle(event, isEditingTarget(event.target))) {
        event.preventDefault()
        toggle()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [toggle])

  const control = useMemo(
    () => ({ theme, resolved, setTheme: ask }),
    [theme, resolved, ask],
  )

  return <ThemeContext value={control}>{children}</ThemeContext>
}

/**
 * Whether a keystroke landed somewhere the user types. It lives here rather
 * than in the Theme core because the core is compiled without the DOM, so that
 * its rules can be tested without a browser.
 */
function isEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }
  if (target.isContentEditable) {
    return true
  }
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

/** What the OS is set to, or light where nothing can be asked. */
function systemPrefersDark(): boolean {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
}
