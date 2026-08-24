/// <reference types="vite/client" />

/**
 * The desktop as Tauri provides it. This is the only file in the app that
 * imports `@tauri-apps/*`: everything else is handed a `Desktop` and cannot
 * tell what is underneath it.
 */

import { getVersion } from '@tauri-apps/api/app'
import { invoke } from '@tauri-apps/api/core'
import { emit, listen } from '@tauri-apps/api/event'
import { LogicalSize } from '@tauri-apps/api/dpi'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import Database from '@tauri-apps/plugin-sql'
import { load } from '@tauri-apps/plugin-store'
import type { CalendarEvent } from '@/journal/journal'
import type { HotkeyStatus } from '@/settings/hotkey'
import type { Theme } from '@/settings/theme'
import {
  CAPTURE_SHOWN_EVENT,
  CAPTURE_WIDTH,
  captureWindowHeight,
  COPY_YESTERDAY_DIGEST_EVENT,
  DATABASE_URL,
  IMPORT_CHANGED_EVENT,
  JOURNAL_CHANGED_EVENT,
  NOTE_CAPTURED_EVENT,
  SETTINGS_FILE,
  SYSTEM_WOKE_EVENT,
  THEME_CHANGED_EVENT,
  type CalendarAccess,
  type CalendarInfo,
  type Desktop,
  type ExportedFile,
} from './desktop'

export function createTauriDesktop(): Desktop {
  return {
    // Outside Tauri — a bare `vite dev` — there is no current window to ask.
    windowLabel() {
      try {
        return getCurrentWindow().label
      } catch {
        return ''
      }
    },

    async appIdentity() {
      return {
        version: await getVersion(),
        // `tauri dev` serves Vite's dev bundle; `tauri build` uses production.
        isDevelopment: import.meta.env.DEV,
      }
    },

    closeWindow: () => getCurrentWindow().close(),

    // Clicking away is a discard, not a Capture left floating over the screen.
    onWindowBlurred: (handle) =>
      getCurrentWindow().onFocusChanged(({ payload: focused }) => {
        if (!focused) handle()
      }),

    async onCloseRequested(answer) {
      const window = getCurrentWindow()
      // Guards the close this makes on the user's behalf, so it cannot
      // re-enter and loop.
      let closing = false

      return window.onCloseRequested((event) => {
        if (closing) return
        closing = true
        // Held open until the answer is written down; a window closing takes
        // its webview, and with it any write still in flight.
        event.preventDefault()
        void answer().finally(() => {
          void window.close()
        })
      })
    },

    async openJournalDatabase() {
      const database = await Database.load(DATABASE_URL)
      return {
        execute: (sql, params) => database.execute(sql, params),
        select: (sql, params) => database.select(sql, params),
      }
    },

    async openSettingsStore() {
      // Every write is flushed rather than debounced, because the Rust side
      // reads the same file at startup and a lost write is a setting that
      // silently did not take.
      const backing = await load(SETTINGS_FILE, { autoSave: false })
      return {
        get: (key) => backing.get(key),
        has: (key) => backing.has(key),
        set: async (key, value) => {
          await backing.set(key, value)
          await backing.save()
        },
      }
    },

    dismissCapture: () => invoke('dismiss_capture'),

    // Built at the resting size in Rust; the height is worked out in one place
    // so the window and the panel drawn inside it cannot disagree.
    fitCapture: (fit) =>
      getCurrentWindow().setSize(
        new LogicalSize(CAPTURE_WIDTH, captureWindowHeight(fit)),
      ),

    onCaptureShown: (handle) => listen(CAPTURE_SHOWN_EVENT, () => handle()),

    onYesterdayDigestRequested: (handle) =>
      listen(COPY_YESTERDAY_DIGEST_EVENT, () => handle()),

    calendarAccess: () => invoke<CalendarAccess>('calendar_access'),
    requestCalendarAccess: () => invoke<CalendarAccess>('request_calendar_access'),
    calendars: () => invoke<CalendarInfo[]>('calendars'),
    todaysCalendarEvents: () => invoke<CalendarEvent[]>('todays_calendar_events'),

    onSystemWoke: (handle) => listen(SYSTEM_WOKE_EVENT, () => handle()),

    announceImportChanged: () => emit(IMPORT_CHANGED_EVENT),
    onImportChanged: (handle) => listen(IMPORT_CHANGED_EVENT, () => handle()),

    announceCapturedNote: (journalDay) =>
      emit(NOTE_CAPTURED_EVENT, { journalDay }),
    onNoteCaptured: (handle) =>
      listen<{ journalDay: string }>(NOTE_CAPTURED_EVENT, ({ payload }) =>
        handle(payload.journalDay),
      ),

    announceJournalChanged: () => emit(JOURNAL_CHANGED_EVENT),
    onJournalChanged: (handle) => listen(JOURNAL_CHANGED_EVENT, () => handle()),

    announceTheme: (theme) => emit(THEME_CHANGED_EVENT, { theme }),
    onThemeChanged: (handle) =>
      listen<{ theme: Theme }>(THEME_CHANGED_EVENT, ({ payload }) =>
        handle(payload.theme),
      ),

    hotkeyStatus: () => invoke<HotkeyStatus>('hotkey_status'),
    setHotkey: (hotkey) => invoke<HotkeyStatus>('set_hotkey', { hotkey }),

    startsAtLogin: () => isEnabled(),

    async setStartAtLogin(startAtLogin) {
      // Asked first, because removing a login item that was never added fails
      // on macOS — and declining on first run is exactly that case.
      if ((await isEnabled()) !== startAtLogin) {
        await (startAtLogin ? enable() : disable())
      }
    },

    // The OS writes it, not the webview: the Tray Menu copies with no window
    // focused, where the webview's own clipboard is not allowed to.
    copyToClipboard: (text) => writeText(text),

    exportNotes: (markdown, fileName) =>
      invoke<ExportedFile>('export_notes', { markdown, fileName }),

    showTrayCount: (title) => invoke('show_tray_count', { title }),
  }
}
