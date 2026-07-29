/**
 * The Theme core: what the app remembers about light and dark, and every rule
 * about when a keystroke is a theme toggle rather than something the user is
 * typing. Pure, and driven from a test without Tauri, a window, or a document.
 *
 * The palette itself lives in `src/index.css`: `.dark` on the document element
 * is the whole mechanism, and everything here decides only whether that class
 * belongs there.
 */

import type { SettingsStore } from './settings'

/**
 * What the user has asked for. `system` is not a third palette — it is the
 * absence of a preference, and defers to whatever the OS is set to.
 */
export type Theme = 'system' | 'light' | 'dark'

/** The two the app can actually paint. */
export type ResolvedTheme = 'light' | 'dark'

/** Unasked, the app follows the OS rather than picking for the user. */
export const DEFAULT_THEME: Theme = 'system'

const THEME_KEY = 'theme'

/**
 * The stored preference, or the default wherever the store is silent or holds
 * something that is not a Theme. A settings file edited by hand must not stop
 * the app from starting — the same rule the rest of the settings follow.
 */
export async function readTheme(store: SettingsStore): Promise<Theme> {
  const stored = await store.get<unknown>(THEME_KEY)
  return isTheme(stored) ? stored : DEFAULT_THEME
}

export async function writeTheme(
  store: SettingsStore,
  theme: Theme,
): Promise<void> {
  if (!isTheme(theme)) {
    throw new Error(`Not a Theme: ${String(theme)}.`)
  }
  await store.set(THEME_KEY, theme)
}

export function isTheme(value: unknown): value is Theme {
  return value === 'system' || value === 'light' || value === 'dark'
}

/** Every Theme, in the order a picker offers them. */
export const THEME_CHOICES: readonly Theme[] = ['system', 'light', 'dark']

/** A Theme as a picker spells it. */
export function describeTheme(theme: Theme): string {
  if (theme === 'system') {
    return 'Match the system'
  }
  return theme === 'dark' ? 'Dark' : 'Light'
}

/** The palette a preference comes to, once the OS has been asked. */
export function resolveTheme(theme: Theme, prefersDark: boolean): ResolvedTheme {
  if (theme === 'system') {
    return prefersDark ? 'dark' : 'light'
  }
  return theme
}

/**
 * The Theme the toggle moves to: the opposite of what is on screen right now.
 * Toggling out of `system` therefore does the visible thing rather than the
 * alphabetical one, and the preference stops following the OS from then on —
 * having asked for a palette, the user gets to keep it.
 */
export function toggledTheme(theme: Theme, prefersDark: boolean): Theme {
  return resolveTheme(theme, prefersDark) === 'dark' ? 'light' : 'dark'
}

/** As much of a keyboard event as recognising the theme shortcut needs. */
export interface ThemeKeystroke {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
}

/**
 * Whether a keystroke is the theme toggle. Cmd/Ctrl+Shift+D, and never a bare
 * `d`: this app is a text field with a window around it, and a shortcut that
 * could fire mid-word would eat the Capture it was meant to serve.
 *
 * `editing` says whether the keystroke landed somewhere text is being entered;
 * even the modified combination stands aside there, because a text field may
 * have its own use for it.
 */
export function isThemeToggle(
  event: ThemeKeystroke,
  editing: boolean,
): boolean {
  if (editing) {
    return false
  }
  return (
    (event.metaKey || event.ctrlKey) &&
    event.shiftKey &&
    event.key.toLowerCase() === 'd'
  )
}
