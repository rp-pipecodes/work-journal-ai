/**
 * The settings as a running window has them: the core's rules over the
 * desktop's store, and the announcements that keep the other windows honest.
 * Built from a Desktop and nothing else, so the suite drives the whole of it
 * without Tauri or a file on disk.
 *
 * It holds no rule of its own — what a valid value is, and what a store that
 * says nothing means, both stay in `settings.ts` and `theme.ts`.
 */

import type { Desktop, Unlisten } from '@/platform/desktop'
import { DEFAULT_DAY_START_HOUR, type DayStart } from '@/journal/journal'
import {
  hasAnsweredStartAtLogin,
  readSettings,
  writeDayStartHour,
  writeStartAtLogin,
  type Settings,
  type SettingsStore,
} from './settings'
import { readTheme, writeTheme, type Theme } from './theme'

export interface AppSettings {
  /** Every setting at once, with a default wherever the store is silent. */
  load(): Promise<Settings>
  /**
   * A new Day Start, remembered and announced. It governs the next Capture in
   * every window and no Note already filed: a Journal Day is decided once, at
   * capture, and never recomputed.
   */
  saveDayStartHour(hour: number): Promise<void>
  onDayStartChanged(handle: (hour: number) => void): Promise<Unlisten>
  /** The Theme as it stands, or `system` until the user has chosen one. */
  loadTheme(): Promise<Theme>
  /**
   * A new Theme, remembered and announced. Every window repaints, including
   * the one the toggle was not pressed in.
   */
  saveTheme(theme: Theme): Promise<void>
  onThemeChanged(handle: (theme: Theme) => void): Promise<Unlisten>
  /**
   * The answer to start at login, acted on and then remembered. The login item
   * is changed first: an answer recorded but not honoured would leave Settings
   * claiming something the OS disagrees with.
   */
  saveStartAtLogin(startAtLogin: boolean): Promise<void>
  /** Whether the first-run question has been answered — either way. */
  hasBeenAskedAboutStartAtLogin(): Promise<boolean>
}

export function createAppSettings(desktop: Desktop): AppSettings {
  // Opened once per window and shared: every setting is in the one file, and
  // the store is what makes a write reach the disk.
  let loading: Promise<SettingsStore> | null = null
  function store(): Promise<SettingsStore> {
    loading ??= desktop.openSettingsStore()
    return loading
  }

  return {
    async load() {
      return readSettings(await store())
    },

    async saveDayStartHour(hour) {
      await writeDayStartHour(await store(), hour)
      await desktop.announceDayStart(hour)
    },

    onDayStartChanged: (handle) => desktop.onDayStartChanged(handle),

    async loadTheme() {
      return readTheme(await store())
    },

    async saveTheme(theme) {
      await writeTheme(await store(), theme)
      await desktop.announceTheme(theme)
    },

    onThemeChanged: (handle) => desktop.onThemeChanged(handle),

    async saveStartAtLogin(startAtLogin) {
      await desktop.setStartAtLogin(startAtLogin)
      await writeStartAtLogin(await store(), startAtLogin)
    },

    async hasBeenAskedAboutStartAtLogin() {
      return hasAnsweredStartAtLogin(await store())
    },
  }
}

/**
 * The Day Start in force, kept current for as long as this window lives. The
 * capture window is built once and never rebuilt, so without this it would
 * spend the rest of the run filing Notes under the Day Start that was set when
 * it started.
 *
 * Ready only once the stored hour has been read, so that no Capture is filed
 * under the default while the answer is still on its way — but a store that
 * cannot be read is not worth failing over: a journal that files under the
 * default beats a Capture that cannot be made at all.
 */
export async function followDayStart(settings: AppSettings): Promise<DayStart> {
  let hour = DEFAULT_DAY_START_HOUR
  // Set by an announcement, which is always newer than the read below —
  // another window can change the Day Start while this one is still reading it.
  let announced = false

  void settings.onDayStartChanged((next) => {
    announced = true
    hour = next
  })

  try {
    const stored = (await settings.load()).dayStartHour
    if (!announced) hour = stored
  } catch (error) {
    console.error('could not read the Day Start', error)
  }

  return { hour: () => hour }
}
