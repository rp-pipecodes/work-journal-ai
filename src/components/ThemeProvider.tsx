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

    const changed = settings.onThemeChanged(setTheme).catch((error: unknown) => {
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
    const root = document.documentElement
    root.classList.toggle(DARK_CLASS, resolved === 'dark')
    // So that form controls and scrollbars the app does not style are painted
    // to match rather than staying stubbornly light.
    root.style.colorScheme = resolved
  }, [resolved])

  const ask = useCallback(
    (next: Theme) => {
      // Applied here rather than waited for: the announcement is how the
      // *other* windows find out, and a store that cannot be written must
      // still repaint the window whose user asked for it.
      setTheme(next)
      void settings.saveTheme(next).catch((error: unknown) => {
        console.error('could not remember the Theme', error)
      })
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
