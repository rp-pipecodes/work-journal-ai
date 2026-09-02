import { createContext, useContext } from 'react'
import { DEFAULT_THEME, type ResolvedTheme, type Theme } from '@/settings/theme'

/**
 * The Theme as a window can see and change it. It lives apart from
 * `ThemeProvider` so that the component file exports only a component, which is
 * what fast refresh needs to swap it without losing state.
 */
export interface ThemeControl {
  /** What the user has asked for, which may be `system`. */
  theme: Theme
  /** What is actually painted, once the OS has been asked. */
  resolved: ResolvedTheme
  /**
   * Asks for a Theme. Remembered, and announced to every other window.
   *
   * The repaint and the announcement are not waited for — a window that
   * cannot be written still repaints — but the promise the write settles with
   * is handed back, so the caller that asked can say what became of it. Every
   * caller may ignore it: the provider has already attached what keeps the
   * rejection from going unheard.
   */
  setTheme: (theme: Theme) => Promise<void>
}

/**
 * The default is inert on purpose: a tree mounted without the provider paints
 * light and quietly ignores a change rather than throwing. Nothing here is
 * load-bearing enough to take a window down over.
 */
export const ThemeContext = createContext<ThemeControl>({
  theme: DEFAULT_THEME,
  resolved: 'light',
  setTheme: () => Promise.resolve(),
})

export function useTheme(): ThemeControl {
  return useContext(ThemeContext)
}
