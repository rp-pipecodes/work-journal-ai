/**
 * The desktop the app runs on, as the app sees it: every window, command,
 * store and cross-window announcement it needs, and nothing else. One
 * implementation talks to Tauri (`tauri-desktop.ts`, the only file in the app
 * that imports `@tauri-apps/*`); the suite drives a fake.
 *
 * Every name shared with the Rust side lives here too, so the two ends of a
 * "must match" pair are one screen apart rather than four files apart.
 */

import type { CalendarEvent, SqlDriver, TaskAlert } from '@/journal/journal'
import type { HotkeyAction, HotkeyStatuses } from '@/settings/hotkey'
import type { SettingsStore } from '@/settings/settings'
import type { Theme } from '@/settings/theme'

/** Stops a subscription. Everything subscribed to here can be unsubscribed. */
export type Unlisten = () => void

/**
 * The window labels. One Vite build serves every window and the label is the
 * only thing that says which — must match `CAPTURE_WINDOW`,
 * `TASK_CREATION_WINDOW` and `MAIN_WINDOW` in `src-tauri/src/lib.rs`.
 *
 * `MAIN_WINDOW` is the window the journal is read in, a section at a time —
 * see docs/adr/0022-one-main-window-for-reading-and-settings.md.
 */
export const CAPTURE_WINDOW = 'capture'
export const TASK_CREATION_WINDOW = 'task-creation'
export const MAIN_WINDOW = 'main'

/**
 * A section of the Main Window, named by whatever asked for it: the Tray Menu
 * and a clicked Task Alert both say which one they mean. The names live here
 * because they cross to the Rust side — must match `HISTORY_SECTION`,
 * `TASKS_SECTION` and `SETTINGS_SECTION` in `src-tauri/src/lib.rs`, and the
 * sidebar's own list in
 * `src/views/main/sections.ts`.
 */
export type MainSection = 'history' | 'tasks' | 'settings'

/**
 * An Entry Point named a section of the Main Window. Addressed to a window
 * already open — one this very request is about to build hears nothing and
 * asks for `requestedSection` instead. Must match `SECTION_REQUESTED_EVENT` in
 * `src-tauri/src/lib.rs`.
 */
export const SECTION_REQUESTED_EVENT = 'main://section'

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
 * A Task Creation is beginning. Like the capture window, the Task Creation
 * window is built at startup and only ever shown and hidden — see
 * docs/adr/0019-task-creation-has-its-own-resident-window.md — so it is told
 * on being shown rather than on being built. Must match
 * `TASK_CREATION_SHOWN_EVENT` in `src-tauri/src/lib.rs`.
 */
export const TASK_CREATION_SHOWN_EVENT = 'task-creation://shown'

/**
 * The Tray Menu asked for yesterday's Digest. Spoken by the Rust side, which
 * owns the menu but not the journal — the Notes are only reachable from a
 * webview, so the tray asks and a window answers. Must match
 * `COPY_YESTERDAY_DIGEST_EVENT` in `src-tauri/src/lib.rs`.
 */
export const COPY_YESTERDAY_DIGEST_EVENT = 'digest://yesterday'

/**
 * What sits under the Capture field right now, and so how tall the window has
 * to be. Both parts grow the window rather than sharing the field's room: the
 * Body being predicted for, or refused, has to stay in sight and stay editable.
 */
export interface CaptureFit {
  /** How many Prediction rows are open under the field. */
  predictions: number
  /** Whether the refusal line is showing under those. */
  refused: boolean
}

/**
 * Capture panel geometry, in the panel's own terms: the field, a Prediction
 * row, the hairline above the first one, and the refusal line. `CaptureView`
 * sizes those elements from these very numbers rather than restating them in
 * classes, so the window and the panel inside it cannot drift apart.
 */
export const CAPTURE_PANEL_WIDTH = 560
export const CAPTURE_FIELD_HEIGHT = 64
export const CAPTURE_PREDICTION_ROW = 36
export const CAPTURE_HAIRLINE = 1
export const CAPTURE_REFUSAL_HEIGHT = 32
/** The panel's own outline, on every side, and outside the widths above. */
export const CAPTURE_PANEL_BORDER = 1

/**
 * The transparent margin the window keeps around the panel. The panel's drop
 * shadow is drawn by the view, and a window sized to the panel would clip it —
 * so the window is bigger than what the user sees, on every side.
 */
export const CAPTURE_SHADOW_GUTTER = 32

/**
 * Window width and resting height — the panel plus its gutter. Must match
 * `.inner_size` in `build_capture_window` (`src-tauri/src/lib.rs`).
 */
const CAPTURE_PANEL_MARGIN = 2 * (CAPTURE_PANEL_BORDER + CAPTURE_SHADOW_GUTTER)
export const CAPTURE_WIDTH = CAPTURE_PANEL_WIDTH + CAPTURE_PANEL_MARGIN
const CAPTURE_HEIGHT = CAPTURE_FIELD_HEIGHT + CAPTURE_PANEL_MARGIN

/**
 * The row under the Task Creation field holding Scheduled For: the date, the
 * time, and the way to clear both. Always there rather than revealed, because
 * a control nobody can see is a feature nobody knows the window has — and its
 * height is fixed, so the window's resting size is a constant rather than
 * something measured.
 */
export const TASK_CREATION_SCHEDULE_ROW = 44

/**
 * The row under that one holding the cadence: whether the Task repeats, how
 * often, and — for a weekly one — on which days. Also always there and also a
 * fixed height, for the same reason: a window whose resting size depended on
 * which cadence was chosen would jump under the user as they chose one.
 */
export const TASK_CREATION_RECURRENCE_ROW = 44

/**
 * The Task Creation panel is the Capture panel's shape — the same width and
 * the same gutter — because they are the same gesture over a different record.
 * It differs in what sits under the field: a Note has only a Body, while a Task
 * may also say when it is meant to be done, so the schedule row is part of the
 * resting height rather than something that grows it.
 *
 * The refusal grows the window on top of that, exactly as it does for a
 * Capture: the description being refused has to stay in sight and stay
 * editable.
 */
export function taskCreationWindowHeight(refused: boolean): number {
  return (
    CAPTURE_HEIGHT +
    CAPTURE_HAIRLINE +
    TASK_CREATION_SCHEDULE_ROW +
    TASK_CREATION_RECURRENCE_ROW +
    (refused ? CAPTURE_REFUSAL_HEIGHT : 0)
  )
}

/**
 * What the Task Creation window is built at, before its view has asked for
 * anything. Must match `.inner_size` in `build_task_creation_window`
 * (`src-tauri/src/lib.rs`).
 */
export const TASK_CREATION_HEIGHT = taskCreationWindowHeight(false)

/** How tall the window has to be to show the field and everything under it. */
export function captureWindowHeight(fit: CaptureFit): number {
  const predictions =
    fit.predictions > 0
      ? CAPTURE_HAIRLINE + fit.predictions * CAPTURE_PREDICTION_ROW
      : 0
  const refusal = fit.refused ? CAPTURE_REFUSAL_HEIGHT : 0

  return CAPTURE_HEIGHT + predictions + refusal
}

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
 * Import was turned on or off, or the ticked calendars changed. Spoken by
 * Settings and heard by the window that sweeps, which is a different one: a
 * change the user just made should show up in the journal now rather than at
 * the next sweep.
 */
export const IMPORT_CHANGED_EVENT = 'settings://import'

/**
 * The machine woke up. Spoken by the Rust side, which is the only part of the
 * app the OS tells. Must match `SYSTEM_WOKE_EVENT` in `src-tauri/src/lib.rs`.
 *
 * Import needs it: a lid closed before a meeting ended would otherwise lose
 * that meeting for good, since nothing ever looks back for it — see
 * docs/adr/0011-imported-meetings-are-today-only.md.
 */
export const SYSTEM_WOKE_EVENT = 'system://woke'

/**
 * The Notes are no longer what they were: one was captured, deleted, refiled or
 * reworded. Distinct from `NOTE_CAPTURED_EVENT`, which says a Note arrived on a
 * particular day and is about the reader's Filter; this one says only that a
 * count taken before it is now out of date.
 */
export const JOURNAL_CHANGED_EVENT = 'journal://changed'

/**
 * The Tasks are no longer what they were: one was created, reworded, completed,
 * reopened or deleted. Separate from `JOURNAL_CHANGED_EVENT` because the two
 * records are separate: a window listing Tasks has nothing to re-read when a
 * Note is corrected, and vice versa.
 */
export const TASKS_CHANGED_EVENT = 'tasks://changed'

/**
 * The user clicked a Task Alert. Spoken by the Rust side, which is the only
 * part of the app macOS hands the click to, and carried to Tasks View so it can
 * open focused on that Task. Must match `TASK_ALERT_OPENED_EVENT` in
 * `src-tauri/src/lib.rs`.
 */
export const TASK_ALERT_OPENED_EVENT = 'task-alert://opened'

/**
 * How a reconciliation went: whether the OS is now holding what the journal
 * says it should. Spoken by the reconciliation, which runs in the capture
 * window and has no screen of its own, and heard by Tasks View, which does. A
 * failure never rolls a Task back — this is only how it stops being silent; see
 * docs/adr/0017-the-os-schedules-task-alerts.md. Spoken and heard entirely on
 * this side, so the Rust side keeps no copy of it.
 */
export const TASK_ALERTS_RECONCILED_EVENT = 'task-alert://reconciled'

/** Where an export ended up — the Rust side's `ExportedFile`. */
export interface ExportedFile {
  path: string
  fileName: string
}

export interface AppIdentity {
  version: string
  isDevelopment: boolean
}

/**
 * What the OS is currently allowing the app to read of the user's calendars.
 * `undetermined` is the state before anyone has been asked, and it is also
 * where macOS leaves a build it has no record of — every rebuilt release is a
 * new binary as far as the grant is concerned, so being asked again is routine
 * rather than exceptional.
 */
export type CalendarAccess = 'granted' | 'denied' | 'undetermined'

/**
 * What the OS is currently allowing the app to deliver as Task Alerts.
 * `undetermined` is the state before the user has been asked — which is where
 * every install starts, because the app asks in context when the first timed
 * Task is saved rather than at first launch.
 *
 * After a denial macOS will not prompt again, whatever the app does, which is
 * why Settings shows the status and the way back rather than a button that
 * would silently do nothing.
 */
export type TaskAlertPermission = 'granted' | 'denied' | 'undetermined'

/** One of the user's calendars, as Settings lists it to be ticked. */
export interface CalendarInfo {
  /** Stable enough to remember a tick against; opaque to the journal. */
  id: string
  title: string
  /** The account it belongs to — two calendars can share a title. */
  source: string
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
   * The window regained focus. A list grouped as Overdue, Today and Upcoming
   * stops being true while nobody is looking at it, so the window that is
   * looked at again asks the question afresh.
   */
  onWindowFocused(handle: () => void): Promise<Unlisten>
  /**
   * Whether the caller's own window is on screen. Asked by the two resident
   * windows when they lose focus: losing it to another application is the user
   * walking away from what they were typing, but losing it because the other
   * resident window was invoked is a handoff, and the Rust side has already put
   * this one away without discarding a word of it.
   */
  isWindowVisible(): Promise<boolean>
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
   * Fits the Capture window to the field plus whatever sits under it. Nothing
   * under it is the resting height — must match the size built in
   * `build_capture_window` on the Rust side.
   */
  fitCapture(fit: CaptureFit): Promise<void>
  /** A Capture is beginning: the window has just been shown. */
  onCaptureShown(handle: () => void): Promise<Unlisten>

  /**
   * Every Task Entry Point — the Task Hotkey, New Task in the Tray Menu, and
   * the New Task control in Tasks View — reaches the same resident window. It
   * is focused rather than reset, so unfinished text survives being asked for
   * again, and an unfinished Capture is untouched either way.
   */
  beginTaskCreation(): Promise<void>
  /**
   * Ends a Task Creation, committed or abandoned. Hiding the window is the Rust
   * side's job: it also has to hand focus back to whatever was in front.
   */
  dismissTaskCreation(): Promise<void>
  /** A Task Creation is beginning: the window has just been shown. */
  onTaskCreationShown(handle: () => void): Promise<Unlisten>
  /**
   * Fits the Task Creation window to the field plus the refusal under it, if
   * there is one. Nothing under it is the resting height — must match the size
   * built in `build_task_creation_window` on the Rust side.
   */
  fitTaskCreation(refused: boolean): Promise<void>

  announceTasksChanged(): Promise<void>
  onTasksChanged(handle: () => void): Promise<Unlisten>

  /**
   * What macOS allows the app to deliver right now, asked rather than
   * remembered: a grant is revoked in System Settings without the app hearing
   * of it. Never prompts.
   */
  taskAlertPermission(): Promise<TaskAlertPermission>
  /**
   * Asks for alert and sound authorization, through the OS, and answers with
   * what it came to. Asked in context when the first timed Task is saved and
   * never at first launch; asking again after a refusal does not re-prompt,
   * because macOS answers for the user.
   */
  requestTaskAlertPermission(): Promise<TaskAlertPermission>
  /**
   * Makes the OS's pending requests say exactly this and nothing else: whatever
   * is here is registered, and every other Task Alert the app owns is
   * cancelled. One call rather than a schedule and a cancel, because the
   * journal is authoritative and the pending requests are a copy of its answer
   * — reconciling is the only operation that can be repeated safely on launch,
   * on wake and after every change.
   *
   * Rejects when the OS refuses. That never rolls back a Task: the schedule is
   * already stored, and the Alert is derived from it.
   */
  reconcileTaskAlerts(alerts: TaskAlert[]): Promise<void>
  /**
   * The user clicked a Task Alert. Carries the Task it was about, so a Tasks
   * View already on screen can single it out. The section the click asks for
   * travels separately, through `onSectionRequested`: the Main Window switches
   * sections, and Tasks View singles the Task out.
   */
  onTaskAlertOpened(handle: (taskId: string) => void): Promise<Unlisten>
  /**
   * Whether the OS took what the journal asked it to hold. Said by the window
   * that reconciles, which is headless, so that the window with a screen can
   * say it to the user — and said either way, so a failure that has since been
   * put right stops being on screen.
   */
  announceTaskAlertsReconciled(held: boolean): Promise<void>
  onTaskAlertsReconciled(handle: (held: boolean) => void): Promise<Unlisten>
  /**
   * Which section the Entry Point that opened this window named, if it named
   * one — asked for by the Main Window as it opens, and null when nothing was
   * named, which resolves to History.
   *
   * Written down rather than only announced, for the same reason the Task
   * Alert is: a window built by the very request that names a section has no
   * webview yet. Handed over exactly once.
   */
  requestedSection(): Promise<MainSection | null>
  /**
   * An Entry Point named a section while the Main Window was already open, so
   * the window switches to it.
   */
  onSectionRequested(handle: (section: MainSection) => void): Promise<Unlisten>

  /**
   * The Task Alert that opened this window, if one did — asked for by Tasks
   * View as it opens, and null when it was opened any other way.
   *
   * The announcement above is not enough on its own: an Alert delivered while
   * Work Journal was not running builds the window with its click, and no
   * webview is listening yet. The Rust side keeps it until it is asked for, and
   * hands it over exactly once.
   */
  openedTaskAlert(): Promise<string | null>
  /**
   * Opens System Settings at Notifications — the only way back after a denial,
   * since macOS will not show its prompt a second time. The pane is opened by
   * its documented identifier; the app never guesses a per-app deep link.
   */
  openNotificationSettings(): Promise<void>
  /** The Tray Menu wants yesterday's Digest on the clipboard. */
  onYesterdayDigestRequested(handle: () => void): Promise<Unlisten>

  /**
   * What the OS allows right now, asked rather than remembered: a grant can be
   * revoked in System Settings, and a rebuilt binary is one macOS has never
   * seen. Never prompts.
   */
  calendarAccess(): Promise<CalendarAccess>
  /**
   * Asks the user, through the OS. Resolves once they have answered, with what
   * the answer came to. Asking again after a refusal does not re-prompt: macOS
   * answers for the user, which is why the app never nags.
   */
  requestCalendarAccess(): Promise<CalendarAccess>
  /** Every calendar the user has, for Settings to offer. Empty without access. */
  calendars(): Promise<CalendarInfo[]>
  /**
   * Today's events, from every calendar — which ones matter is the journal's
   * decision, not the machine's. Empty without access.
   */
  todaysCalendarEvents(): Promise<CalendarEvent[]>
  /** The machine woke from sleep: whatever was missed is worth looking for. */
  onSystemWoke(handle: () => void): Promise<Unlisten>
  announceImportChanged(): Promise<void>
  onImportChanged(handle: () => void): Promise<Unlisten>

  announceCapturedNote(journalDay: string): Promise<void>
  onNoteCaptured(handle: (journalDay: string) => void): Promise<Unlisten>
  announceJournalChanged(): Promise<void>
  onJournalChanged(handle: () => void): Promise<Unlisten>
  announceTheme(theme: Theme): Promise<void>
  onThemeChanged(handle: (theme: Theme) => void): Promise<Unlisten>

  /** Both Hotkeys as they stand, each registered or not. */
  hotkeyStatus(): Promise<HotkeyStatuses>
  /**
   * Moves one of the two Hotkeys. Rejects with the reason the OS gave — or with
   * the collision, since the two may never share a combination — in which case
   * both combinations in force are unchanged: the Rust side puts the old one
   * back rather than leaving the user with none.
   */
  setHotkey(action: HotkeyAction, hotkey: string): Promise<HotkeyStatuses>

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
  exportJournal(markdown: string, fileName: string): Promise<ExportedFile>

  /**
   * Puts a short piece of text beside the menu bar glyph. Rendered by the
   * journal core, never here: this only carries it across to the tray. macOS
   * only — elsewhere the glyph stands alone and this does nothing.
   */
  showTrayCount(title: string): Promise<void>
}
