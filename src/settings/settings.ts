/**
 * The settings core: what the app remembers between runs, and every rule about
 * what a valid value is. It depends on one injected collaborator — a key-value
 * store — so it can be driven from a test without Tauri or a file on disk.
 *
 * Nothing here is a secret. v1 has no API key, which is the whole reason a
 * plain JSON store is acceptable at all — see
 * docs/adr/0001-defer-voice-capture-to-v2.md for where a credential would go
 * if voice ever returns.
 */

import { START_AT_LOGIN_KEY } from '@/platform/desktop'

/** The whole of the app's settings storage: string keys to JSON values. */
export interface SettingsStore {
  get<T>(key: string): Promise<T | undefined>
  has(key: string): Promise<boolean>
  set(key: string, value: unknown): Promise<void>
}

/**
 * What the app remembers between runs, minus the Hotkey: that one is claimed
 * from the OS rather than merely stored, so the Rust side owns both registering
 * it and remembering it — see `src-tauri/src/hotkey.rs`, and `./hotkey.ts` for
 * what this side of it knows.
 *
 * Day Start is gone — see docs/adr/0005-no-day-start.md. A leftover
 * `dayStartHour` in the store is ignored.
 */
export interface Settings {
  /** Off until the user says otherwise: the app never adds itself uninvited. */
  startAtLogin: boolean
  /**
   * The user's wish for Import: whether they want today's meetings swept into
   * the journal. Off until turned on, and only ever written by the user — a
   * permission refused or revoked leaves it standing, which is what lets
   * Settings say why Import is not running, and what lets a grant restored in
   * System Settings resume it without asking a second time. Whether Import
   * actually runs is this and the OS answer together, derived where it is
   * needed. The journal keeps working exactly as before either way.
   */
  importMeetings: boolean
  /**
   * The calendars an Import reads, by identifier. None ticked by default, so
   * turning Import on sweeps nothing until the user says which calendars mean
   * work. An unticked calendar is ignored entirely.
   */
  importCalendars: string[]
}

export const DEFAULT_SETTINGS: Settings = {
  startAtLogin: false,
  importMeetings: false,
  importCalendars: [],
}

/**
 * The store keys. The Hotkey's own key is written from Rust, and start at login
 * is imported rather than declared here because the Rust side reads that one —
 * every name shared with it lives in `src/platform/desktop.ts`.
 */
const IMPORT_MEETINGS_KEY = 'importMeetings'
const IMPORT_CALENDARS_KEY = 'importCalendars'

/**
 * Every setting at once, with a default wherever the store is silent or holds
 * something that is not a value at all. A settings file edited by hand, or
 * written by an older version, must not stop the app from starting.
 */
export async function readSettings(store: SettingsStore): Promise<Settings> {
  const [startAtLogin, importMeetings, importCalendars] = await Promise.all([
    store.get<unknown>(START_AT_LOGIN_KEY),
    store.get<unknown>(IMPORT_MEETINGS_KEY),
    store.get<unknown>(IMPORT_CALENDARS_KEY),
  ])

  return {
    startAtLogin:
      typeof startAtLogin === 'boolean'
        ? startAtLogin
        : DEFAULT_SETTINGS.startAtLogin,
    importMeetings:
      typeof importMeetings === 'boolean'
        ? importMeetings
        : DEFAULT_SETTINGS.importMeetings,
    // Anything that is not a list of names says nothing about which calendars
    // the user meant, and Import reading the wrong ones is worse than reading
    // none: it writes Notes the user never asked for.
    importCalendars: Array.isArray(importCalendars)
      ? importCalendars.filter((id): id is string => typeof id === 'string')
      : DEFAULT_SETTINGS.importCalendars,
  }
}

/** Whether meetings are swept at all. Both answers are the user's. */
export async function writeImportMeetings(
  store: SettingsStore,
  importMeetings: boolean,
): Promise<void> {
  await store.set(IMPORT_MEETINGS_KEY, importMeetings)
}

/** Which calendars an Import reads. An empty list is a real answer: none. */
export async function writeImportCalendars(
  store: SettingsStore,
  importCalendars: string[],
): Promise<void> {
  await store.set(IMPORT_CALENDARS_KEY, importCalendars)
}

/** Both answers are answers: declining is recorded exactly as accepting is. */
export async function writeStartAtLogin(
  store: SettingsStore,
  startAtLogin: boolean,
): Promise<void> {
  await store.set(START_AT_LOGIN_KEY, startAtLogin)
}

/**
 * Whether start at login has ever been asked about. The question is offered
 * once, on first run, and a "no" has to count — otherwise the app would ask
 * again every launch until it got the answer it wanted.
 */
export function hasAnsweredStartAtLogin(
  store: SettingsStore,
): Promise<boolean> {
  return store.has(START_AT_LOGIN_KEY)
}
