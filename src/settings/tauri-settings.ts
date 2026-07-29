import { invoke } from '@tauri-apps/api/core'
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event'
import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart'
import { load } from '@tauri-apps/plugin-store'
import {
  hasAnsweredStartAtLogin,
  readSettings,
  writeDayStartHour,
  writeStartAtLogin,
  type HotkeyStatus,
  type Settings,
  type SettingsStore,
} from './settings'
import { readTheme, writeTheme, type Theme } from './theme'

/** Must match `SETTINGS_FILE` in `src-tauri/src/lib.rs`. */
const SETTINGS_FILE = 'settings.json'

/**
 * The Day Start has changed. Every window keeps its own journal, so one already
 * on screen only learns of a new Day Start by being told — and the capture
 * window, which is never rebuilt, would otherwise go on using the old one for
 * the rest of the run.
 */
const DAY_START_CHANGED_EVENT = 'settings://day-start'

/**
 * The Theme has changed. Every window paints itself, so one already on screen
 * only learns of a new Theme by being told — and the capture window, which is
 * never rebuilt, would otherwise stay the old palette for the rest of the run.
 */
const THEME_CHANGED_EVENT = 'settings://theme'

let loading: Promise<SettingsStore> | null = null

/**
 * The settings as this window sees them: plugin-store, with every write
 * flushed rather than debounced, because the Rust side reads the same file at
 * startup and a lost write is a setting that silently did not take.
 */
function store(): Promise<SettingsStore> {
  loading ??= load(SETTINGS_FILE, { autoSave: false }).then((backing) => ({
    get: (key) => backing.get(key),
    has: (key) => backing.has(key),
    set: async (key, value) => {
      await backing.set(key, value)
      await backing.save()
    },
  }))
  return loading
}

export async function loadSettings(): Promise<Settings> {
  return readSettings(await store())
}

/**
 * A new Day Start, remembered and announced. It governs the next Capture in
 * every window and no Note already filed: a Journal Day is decided once, at
 * capture, and never recomputed.
 */
export async function saveDayStartHour(hour: number): Promise<void> {
  await writeDayStartHour(await store(), hour)
  await emit(DAY_START_CHANGED_EVENT, { hour })
}

export function onDayStartChanged(
  handle: (hour: number) => void,
): Promise<UnlistenFn> {
  return listen<{ hour: number }>(DAY_START_CHANGED_EVENT, ({ payload }) =>
    handle(payload.hour),
  )
}

/** The Theme as it stands, or `system` until the user has chosen one. */
export async function loadTheme(): Promise<Theme> {
  return readTheme(await store())
}

/**
 * A new Theme, remembered and announced. Every window repaints, including the
 * one the toggle was not pressed in.
 */
export async function saveTheme(theme: Theme): Promise<void> {
  await writeTheme(await store(), theme)
  await emit(THEME_CHANGED_EVENT, { theme })
}

export function onThemeChanged(
  handle: (theme: Theme) => void,
): Promise<UnlistenFn> {
  return listen<{ theme: Theme }>(THEME_CHANGED_EVENT, ({ payload }) =>
    handle(payload.theme),
  )
}

/**
 * The answer to start at login, acted on and then remembered. The login item
 * is changed first: an answer recorded but not honoured would leave Settings
 * claiming something the OS disagrees with.
 */
export async function saveStartAtLogin(startAtLogin: boolean): Promise<void> {
  // Asked first, because removing a login item that was never added fails on
  // macOS — and declining on first run is exactly that case.
  if ((await isEnabled()) !== startAtLogin) {
    await (startAtLogin ? enable() : disable())
  }
  await writeStartAtLogin(await store(), startAtLogin)
}

/**
 * Whether the app actually starts at login, asked of the OS rather than of the
 * store: a login item can be removed from System Settings, and a checkbox that
 * disagreed with the system would be a lie.
 */
export function startsAtLogin(): Promise<boolean> {
  return isEnabled()
}

/** Whether the first-run question has been answered — either way. */
export async function hasBeenAskedAboutStartAtLogin(): Promise<boolean> {
  return hasAnsweredStartAtLogin(await store())
}

/** The Hotkey as it stands, registered or not. */
export function hotkeyStatus(): Promise<HotkeyStatus> {
  return invoke<HotkeyStatus>('hotkey_status')
}

/**
 * Moves the Hotkey. Rejects with the reason the OS gave, in which case the
 * combination in force is unchanged — the Rust side puts the old one back
 * rather than leaving the user with none.
 */
export function setHotkey(hotkey: string): Promise<HotkeyStatus> {
  return invoke<HotkeyStatus>('set_hotkey', { hotkey })
}

/** Where an export ended up — the Rust side's `ExportedFile`. */
export interface ExportedFile {
  path: string
  fileName: string
}

/** Writes a rendered export to a file, and says where it went. */
export function exportNotes(
  markdown: string,
  fileName: string,
): Promise<ExportedFile> {
  return invoke<ExportedFile>('export_notes', { markdown, fileName })
}
