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
import {
  hasAnsweredStartAtLogin,
  readSettings,
  writeImportCalendars,
  writeImportMeetings,
  writeModel,
  writeModelBaseUrl,
  writeStandupPrompt,
  writeStartAtLogin,
  type Settings,
  type SettingsStore,
} from './settings'
import { readTheme, writeTheme, type Theme } from './theme'

export interface AppSettings {
  /** Every setting at once, with a default wherever the store is silent. */
  load(): Promise<Settings>
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
  /**
   * Whether meetings are swept, remembered and announced. Announced because
   * the window that sweeps is not the window this is changed in, and a change
   * the user just made should reach the journal now rather than at the next
   * sweep. Only the user reaches this: the sweep returns when the calendar
   * permission is gone rather than writing the wish off, so the reason
   * Settings owes the user survives.
   */
  saveImportMeetings(importMeetings: boolean): Promise<void>
  /** Which calendars an Import reads. Announced for the same reason. */
  saveImportCalendars(importCalendars: string[]): Promise<void>
  /**
   * Where the model is. Not announced: nothing but the window it was typed in
   * is looking at it, and whatever reads it next reads it when it needs it.
   */
  saveModelBaseUrl(modelBaseUrl: string): Promise<void>
  /** Which model to ask. Stored the same way, and for the same reason. */
  saveModel(model: string): Promise<void>
  /**
   * The prompt a Standup Post is written under. Stored the same way, and for
   * the same reason: nothing but the window it was typed in is looking at it,
   * and whatever reads it next reads it when it needs it.
   */
  saveStandupPrompt(standupPrompt: string): Promise<void>
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

    async saveImportMeetings(importMeetings) {
      await writeImportMeetings(await store(), importMeetings)
      await desktop.announceImportChanged()
    },

    async saveImportCalendars(importCalendars) {
      await writeImportCalendars(await store(), importCalendars)
      await desktop.announceImportChanged()
    },

    async saveModelBaseUrl(modelBaseUrl) {
      await writeModelBaseUrl(await store(), modelBaseUrl)
    },

    async saveModel(model) {
      await writeModel(await store(), model)
    },

    async saveStandupPrompt(standupPrompt) {
      await writeStandupPrompt(await store(), standupPrompt)
    },
  }
}
