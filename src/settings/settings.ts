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

import { DEFAULT_DAY_START_HOUR } from '../journal/journal'

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
 */
export interface Settings {
  /** The hour at which one Journal Day gives way to the next. */
  dayStartHour: number
  /** Off until the user says otherwise: the app never adds itself uninvited. */
  startAtLogin: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  dayStartHour: DEFAULT_DAY_START_HOUR,
  startAtLogin: false,
}

/** The store keys. The Hotkey's own key is written from Rust. */
const DAY_START_HOUR_KEY = 'dayStartHour'
const START_AT_LOGIN_KEY = 'startAtLogin'

/** Every hour a Day Start can be, in the order a picker offers them. */
export const DAY_START_HOURS: readonly number[] = Array.from(
  { length: 24 },
  (_, hour) => hour,
)

/**
 * Every setting at once, with a default wherever the store is silent or holds
 * something that is not a value at all. A settings file edited by hand, or
 * written by an older version, must not stop the app from starting.
 */
export async function readSettings(store: SettingsStore): Promise<Settings> {
  const [dayStartHour, startAtLogin] = await Promise.all([
    store.get<unknown>(DAY_START_HOUR_KEY),
    store.get<unknown>(START_AT_LOGIN_KEY),
  ])

  return {
    dayStartHour: isDayStartHour(dayStartHour)
      ? dayStartHour
      : DEFAULT_SETTINGS.dayStartHour,
    startAtLogin:
      typeof startAtLogin === 'boolean'
        ? startAtLogin
        : DEFAULT_SETTINGS.startAtLogin,
  }
}

/**
 * A new Day Start. It governs the next Capture and no earlier one: a Journal
 * Day is decided once, at capture, and never recomputed.
 */
export async function writeDayStartHour(
  store: SettingsStore,
  hour: number,
): Promise<void> {
  if (!isDayStartHour(hour)) {
    throw new Error(`Not a Day Start: ${hour}.`)
  }
  await store.set(DAY_START_HOUR_KEY, hour)
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

/** A Day Start is a whole hour of the day, not an arbitrary number. */
export function isDayStartHour(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 23
  )
}

/** A Day Start as the time of day it is, so a picker reads as a clock. */
export function formatDayStartHour(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`
}

