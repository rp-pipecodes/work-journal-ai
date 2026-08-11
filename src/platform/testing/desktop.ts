import type { SqlDriver } from '../../journal/journal'
import type { HotkeyStatus } from '../../settings/hotkey'
import type { SettingsStore } from '../../settings/settings'
import type { Theme } from '../../settings/theme'
import type {
  AppIdentity,
  Desktop,
  ExportedFile,
  Unlisten,
} from '../desktop'

/**
 * The desktop a test runs on: the same surface, in memory. Announcements are
 * delivered to every subscriber, including the window that made them — which
 * is what the real one does too, so a test sees what a second window would.
 */
export interface FakeDesktop extends Desktop {
  /** What the settings store holds, readable without going through a facade. */
  stored: Record<string, unknown>
  /** Whether the login item is there, as the OS would report it. */
  loginItem: boolean
  /** Every export written, most recent last. */
  exported: Array<{ markdown: string; fileName: string }>
}

export function fakeDesktop({
  driver,
  stored = {},
  hotkey = { state: 'registered', hotkey: 'Cmd+Shift+J' },
  appIdentity = { version: 'test', isDevelopment: true },
  openSettingsStore,
}: {
  /** Only the tests that reach the journal need one. */
  driver?: SqlDriver
  stored?: Record<string, unknown>
  hotkey?: HotkeyStatus
  appIdentity?: AppIdentity
  /** Overridden by the tests about a settings file that cannot be read. */
  openSettingsStore?: () => Promise<SettingsStore>
} = {}): FakeDesktop {
  const noteCaptured = subscribers<string>()
  const themeChanged = subscribers<Theme>()

  const desktop: FakeDesktop = {
    stored,
    loginItem: false,
    exported: [],

    windowLabel: () => 'history',
    appIdentity: async () => appIdentity,
    closeWindow: async () => {},
    onWindowBlurred: async () => () => {},
    onCloseRequested: async () => () => {},

    openJournalDatabase: async () => {
      if (driver === undefined) {
        throw new Error('This fake desktop was built without a database.')
      }
      return driver
    },

    openSettingsStore:
      openSettingsStore ??
      (async () => ({
        async get<T>(key: string) {
          return desktop.stored[key] as T | undefined
        },
        async has(key: string) {
          return key in desktop.stored
        },
        async set(key: string, value: unknown) {
          desktop.stored[key] = value
        },
      })),

    dismissCapture: async () => {},
    fitCapture: async () => {},
    onCaptureShown: async () => () => {},

    announceCapturedNote: async (journalDay) => noteCaptured.announce(journalDay),
    onNoteCaptured: async (handle) => noteCaptured.add(handle),
    announceTheme: async (theme) => themeChanged.announce(theme),
    onThemeChanged: async (handle) => themeChanged.add(handle),

    hotkeyStatus: async () => hotkey,
    setHotkey: async (next) => ({ state: 'registered', hotkey: next }),

    startsAtLogin: async () => desktop.loginItem,
    setStartAtLogin: async (startAtLogin) => {
      desktop.loginItem = startAtLogin
    },

    exportNotes: async (markdown, fileName): Promise<ExportedFile> => {
      desktop.exported.push({ markdown, fileName })
      return { path: `/tmp/${fileName}`, fileName }
    },
  }

  return desktop
}

function subscribers<T>() {
  const handlers = new Set<(value: T) => void>()
  return {
    add(handle: (value: T) => void): Unlisten {
      handlers.add(handle)
      return () => handlers.delete(handle)
    },
    announce(value: T): void {
      for (const handle of handlers) handle(value)
    },
  }
}
