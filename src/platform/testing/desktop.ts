import type { CalendarEvent, SqlDriver } from '../../journal/journal'
import type { HotkeyStatuses } from '../../settings/hotkey'
import type { SettingsStore } from '../../settings/settings'
import type { Theme } from '../../settings/theme'
import type {
  AppIdentity,
  CalendarAccess,
  CalendarInfo,
  CaptureFit,
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
  /** Shows the capture window, as an Entry Point would. */
  beginCapture(): void
  /** Shows the Task Creation window, as a Task Entry Point would. */
  showTaskCreation(): void
  /** How many times a Task Entry Point asked for the resident window. */
  taskCreationsBegun: number
  /** How many times a Task Creation was dismissed. */
  taskCreationsDismissed: number
  /** Every size the Task Creation window was asked to take, most recent last. */
  taskCreationFits: boolean[]
  /** What the settings store holds, readable without going through a facade. */
  stored: Record<string, unknown>
  /** Whether the login item is there, as the OS would report it. */
  loginItem: boolean
  /** Every export written, most recent last. */
  exported: Array<{ markdown: string; fileName: string }>
  /** Every size the Capture window was asked to take, most recent last. */
  fits: CaptureFit[]
  /** What is beside the menu bar glyph; null until something is put there. */
  trayTitle: string | null
  /** What is on the clipboard; null until something is copied there. */
  clipboard: string | null
  /** The Tray Menu asks for yesterday's Digest. */
  requestYesterdayDigest(): void
  /** The machine wakes from sleep. */
  wake(): void
  /** What the OS allows of the calendars; writable, as a revocation is. */
  access: CalendarAccess
  /** Whether the user was ever asked, and what they said if they were. */
  prompted: boolean
  /** What the calendars hold today. */
  events: CalendarEvent[]
}

export function fakeDesktop({
  driver,
  stored = {},
  hotkey = {
    note: { state: 'registered', hotkey: 'Ctrl+Shift+Cmd+J' },
    task: { state: 'registered', hotkey: 'Ctrl+Shift+Cmd+T' },
  },
  appIdentity = { version: 'test', isDevelopment: true },
  openSettingsStore,
  access = 'undetermined',
  answersPrompt = 'granted',
  calendars = [],
  events = [],
}: {
  /** Only the tests that reach the journal need one. */
  driver?: SqlDriver
  stored?: Record<string, unknown>
  hotkey?: HotkeyStatuses
  appIdentity?: AppIdentity
  /** Overridden by the tests about a settings file that cannot be read. */
  openSettingsStore?: () => Promise<SettingsStore>
  /** What the OS allows before anybody asks. */
  access?: CalendarAccess
  /** What answering the prompt comes to. */
  answersPrompt?: CalendarAccess
  calendars?: CalendarInfo[]
  events?: CalendarEvent[]
} = {}): FakeDesktop {
  const captureShown = subscribers<void>()
  const taskCreationShown = subscribers<void>()
  const tasksChanged = subscribers<void>()
  const systemWoke = subscribers<void>()
  const importChanged = subscribers<void>()
  const yesterdayDigestRequested = subscribers<void>()
  const noteCaptured = subscribers<string>()
  const journalChanged = subscribers<void>()
  const themeChanged = subscribers<Theme>()

  const desktop: FakeDesktop = {
    stored,
    loginItem: false,
    exported: [],
    fits: [],
    trayTitle: null,
    clipboard: null,
    access,
    prompted: false,
    events,
    taskCreationsBegun: 0,
    taskCreationsDismissed: 0,
    taskCreationFits: [],

    beginCapture: () => captureShown.announce(undefined),
    showTaskCreation: () => taskCreationShown.announce(undefined),
    requestYesterdayDigest: () => yesterdayDigestRequested.announce(undefined),
    wake: () => systemWoke.announce(undefined),

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
    fitCapture: async (fit) => {
      desktop.fits.push(fit)
    },
    onCaptureShown: async (handle) => captureShown.add(handle),

    // Every Task Entry Point reaches the same resident window: the real one
    // focuses it without resetting it, so this only counts the asking.
    beginTaskCreation: async () => {
      desktop.taskCreationsBegun += 1
      taskCreationShown.announce(undefined)
    },
    dismissTaskCreation: async () => {
      desktop.taskCreationsDismissed += 1
    },
    onTaskCreationShown: async (handle) => taskCreationShown.add(handle),
    fitTaskCreation: async (refused) => {
      desktop.taskCreationFits.push(refused)
    },
    announceTasksChanged: async () => tasksChanged.announce(undefined),
    onTasksChanged: async (handle) => tasksChanged.add(handle),
    onYesterdayDigestRequested: async (handle) =>
      yesterdayDigestRequested.add(handle),

    calendarAccess: async () => desktop.access,
    requestCalendarAccess: async () => {
      desktop.prompted = true
      // macOS answers for the user once it has an answer on file, which is why
      // the app never nags: asking again after a refusal does not re-prompt.
      if (desktop.access === 'undetermined') {
        desktop.access = answersPrompt
      }
      return desktop.access
    },
    calendars: async () => (desktop.access === 'granted' ? calendars : []),
    todaysCalendarEvents: async () =>
      desktop.access === 'granted' ? desktop.events : [],

    onSystemWoke: async (handle) => systemWoke.add(handle),
    announceImportChanged: async () => importChanged.announce(undefined),
    onImportChanged: async (handle) => importChanged.add(handle),

    announceCapturedNote: async (journalDay) => noteCaptured.announce(journalDay),
    onNoteCaptured: async (handle) => noteCaptured.add(handle),
    announceJournalChanged: async () => journalChanged.announce(undefined),
    onJournalChanged: async (handle) => journalChanged.add(handle),
    announceTheme: async (theme) => themeChanged.announce(theme),
    onThemeChanged: async (handle) => themeChanged.add(handle),

    hotkeyStatus: async () => hotkey,
    setHotkey: async (action, next) => ({
      ...hotkey,
      [action]: { state: 'registered', hotkey: next },
    }),

    startsAtLogin: async () => desktop.loginItem,
    setStartAtLogin: async (startAtLogin) => {
      desktop.loginItem = startAtLogin
    },

    copyToClipboard: async (text) => {
      desktop.clipboard = text
    },

    exportJournal: async (markdown, fileName): Promise<ExportedFile> => {
      desktop.exported.push({ markdown, fileName })
      return { path: `/tmp/${fileName}`, fileName }
    },

    showTrayCount: async (title) => {
      desktop.trayTitle = title
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
