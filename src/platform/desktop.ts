/**
 * The desktop the app runs on, as the app sees it: every window, command,
 * store and cross-window announcement it needs, and nothing else. One
 * implementation talks to Tauri (`tauri-desktop.ts`, the only file in the app
 * that imports `@tauri-apps/*`); the suite drives a fake.
 *
 * Every name shared with the Rust side lives here too, so the two ends of a
 * "must match" pair are one screen apart rather than four files apart.
 */

import type { SqlDriver } from '@/journal/journal'
import type { HotkeyStatus } from '@/settings/hotkey'
import type { SettingsStore } from '@/settings/settings'
import type { Theme } from '@/settings/theme'

/** Stops a subscription. Everything subscribed to here can be unsubscribed. */
export type Unlisten = () => void

/**
 * The window labels. One Vite build serves every window and the label is the
 * only thing that says which — must match `CAPTURE_WINDOW`, `HISTORY_WINDOW`
 * and `SETTINGS_WINDOW` in `src-tauri/src/lib.rs`.
 */
export const CAPTURE_WINDOW = 'capture'
export const HISTORY_WINDOW = 'history'
export const SETTINGS_WINDOW = 'settings'

/** Must match `SETTINGS_FILE` in `src-tauri/src/lib.rs`. */
export const SETTINGS_FILE = 'settings.json'

/** Must match `THEME_KEY` in `src-tauri/src/lib.rs`. */
export const THEME_KEY = 'theme'

/**
 * Where a window is told its Resolved Theme, before its document is parsed and
 * so before anything is painted — the Rust side works the palette out and sets
 * this, because the store cannot be read in time to get the first frame right.
 * Must match `ResolvedTheme::announcement` in `src-tauri/src/lib.rs`.
 *
 * Absent outside Tauri — a bare `vite dev` — where the OS is asked instead.
 */
declare global {
  interface Window {
    __THEME__?: 'light' | 'dark'
  }
}

/** Must match `DATABASE_URL` in `src-tauri/src/lib.rs`. */
export const DATABASE_URL = 'sqlite:work-journal.db'

/** Must match `CAPTURE_SHOWN_EVENT` in `src-tauri/src/lib.rs`. */
export const CAPTURE_SHOWN_EVENT = 'capture://shown'

/**
 * The Tray Menu asked for yesterday's Digest. Spoken by the Rust side, which
 * owns the menu but not the journal — the Notes are only reachable from a
 * webview, so the tray asks and a window answers. Must match
 * `COPY_YESTERDAY_DIGEST_EVENT` in `src-tauri/src/lib.rs`.
 */
export const COPY_YESTERDAY_DIGEST_EVENT = 'digest://yesterday'

/**
 * Capture window geometry. Width and resting height must match `.inner_size`
 * in `build_capture_window` (`src-tauri/src/lib.rs`). Row height must match
 * the Prediction button (`h-8`) in `CaptureView`.
 */
export const CAPTURE_WIDTH = 560
export const CAPTURE_FIELD_HEIGHT = 64
export const CAPTURE_PREDICTION_ROW = 32

/**
 * The announcements the windows make to each other. These two are spoken only
 * in TypeScript, but they sit with the rest so that every event name in the app
 * is in one place.
 *
 * Each exists because the windows are separate: one already on screen learns
 * of a Note or a Theme only by being told — it never polls, and the capture
 * window is never rebuilt, so it would otherwise spend the rest of the run on
 * whatever was true when it started.
 */
export const NOTE_CAPTURED_EVENT = 'note://captured'
export const THEME_CHANGED_EVENT = 'settings://theme'

/**
 * The Notes are no longer what they were: one was captured, deleted, refiled or
 * reworded. Distinct from `NOTE_CAPTURED_EVENT`, which says a Note arrived on a
 * particular day and is about the reader's Filter; this one says only that a
 * count taken before it is now out of date.
 */
export const JOURNAL_CHANGED_EVENT = 'journal://changed'

/** Where an export ended up — the Rust side's `ExportedFile`. */
export interface ExportedFile {
  path: string
  fileName: string
}

export interface AppIdentity {
  version: string
  isDevelopment: boolean
}

export interface Desktop {
  /** Which window this bundle is running in; empty outside the desktop app. */
  windowLabel(): string
  /** The configured app version and whether this bundle is a development build. */
  appIdentity(): Promise<AppIdentity>
  /** Closes the window the caller is in. */
  closeWindow(): Promise<void>
  /** The window lost focus — for a Capture, a discard. */
  onWindowBlurred(handle: () => void): Promise<Unlisten>
  /**
   * The user is closing the window, and something has to happen first. The
   * close is held until `answer` settles, because a window closing takes its
   * webview and with it any write still in flight.
   */
  onCloseRequested(answer: () => Promise<void>): Promise<Unlisten>

  /** The journal's storage, migrated and ready. */
  openJournalDatabase(): Promise<SqlDriver>
  /** The settings file, with every write flushed rather than debounced. */
  openSettingsStore(): Promise<SettingsStore>

  /**
   * Ends a Capture. Hiding the window is the Rust side's job: it also has to
   * hand focus back to the application the Capture interrupted.
   */
  dismissCapture(): Promise<void>
  /**
   * Fits the Capture window to the field plus any Predictions underneath.
   * Zero Predictions is the resting height — must match the size built in
   * `build_capture_window` on the Rust side.
   */
  fitCapture(predictionCount: number): Promise<void>
  /** A Capture is beginning: the window has just been shown. */
  onCaptureShown(handle: () => void): Promise<Unlisten>
  /** The Tray Menu wants yesterday's Digest on the clipboard. */
  onYesterdayDigestRequested(handle: () => void): Promise<Unlisten>

  announceCapturedNote(journalDay: string): Promise<void>
  onNoteCaptured(handle: (journalDay: string) => void): Promise<Unlisten>
  announceJournalChanged(): Promise<void>
  onJournalChanged(handle: () => void): Promise<Unlisten>
  announceTheme(theme: Theme): Promise<void>
  onThemeChanged(handle: (theme: Theme) => void): Promise<Unlisten>

  /** The Hotkey as it stands, registered or not. */
  hotkeyStatus(): Promise<HotkeyStatus>
  /**
   * Moves the Hotkey. Rejects with the reason the OS gave, in which case the
   * combination in force is unchanged — the Rust side puts the old one back
   * rather than leaving the user with none.
   */
  setHotkey(hotkey: string): Promise<HotkeyStatus>

  /**
   * Whether the app actually starts at login, asked of the OS rather than of
   * the store: a login item can be removed from System Settings, and a
   * checkbox that disagreed with the system would be a lie.
   */
  startsAtLogin(): Promise<boolean>
  /** Adds or removes the login item. */
  setStartAtLogin(startAtLogin: boolean): Promise<void>

  /**
   * Puts text on the system clipboard. Written by the OS rather than by the
   * webview: a Digest is also copied from the Tray Menu, where no window is
   * focused and no click is granting the page user activation.
   */
  copyToClipboard(text: string): Promise<void>

  /** Writes a rendered export to a file, and says where it went. */
  exportNotes(markdown: string, fileName: string): Promise<ExportedFile>

  /**
   * Puts a short piece of text beside the menu bar glyph. Rendered by the
   * journal core, never here: this only carries it across to the tray. macOS
   * only — elsewhere the glyph stands alone and this does nothing.
   */
  showTrayCount(title: string): Promise<void>
}
