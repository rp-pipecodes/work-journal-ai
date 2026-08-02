/**
 * The desktop as Tauri provides it. This is the only file in the app that
 * imports `@tauri-apps/*`: everything else is handed a `Desktop` and cannot
 * tell what is underneath it.
 */

import { invoke } from '@tauri-apps/api/core'
import { emit, listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart'
import Database from '@tauri-apps/plugin-sql'
import { load } from '@tauri-apps/plugin-store'
import type { HotkeyStatus } from '@/settings/hotkey'
import type { Theme } from '@/settings/theme'
import {
  CAPTURE_SHOWN_EVENT,
  DATABASE_URL,
  DAY_START_CHANGED_EVENT,
  NOTE_CAPTURED_EVENT,
  SETTINGS_FILE,
  THEME_CHANGED_EVENT,
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

    closeWindow: () => getCurrentWindow().close(),

    // Asked of the Rust side rather than done here with `getCurrentWindow()`,
    // so that showing a window and taking focus stay in the one place.
    revealWindow: () => invoke('reveal_window'),

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
    onCaptureShown: (handle) => listen(CAPTURE_SHOWN_EVENT, () => handle()),

    announceCapturedNote: (journalDay) =>
      emit(NOTE_CAPTURED_EVENT, { journalDay }),
    onNoteCaptured: (handle) =>
      listen<{ journalDay: string }>(NOTE_CAPTURED_EVENT, ({ payload }) =>
        handle(payload.journalDay),
      ),

    announceDayStart: (hour) => emit(DAY_START_CHANGED_EVENT, { hour }),
    onDayStartChanged: (handle) =>
      listen<{ hour: number }>(DAY_START_CHANGED_EVENT, ({ payload }) =>
        handle(payload.hour),
      ),

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

    exportNotes: (markdown, fileName) =>
      invoke<ExportedFile>('export_notes', { markdown, fileName }),
  }
}
