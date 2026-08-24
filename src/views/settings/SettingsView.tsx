import { useCallback, useEffect, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useTheme } from '@/components/theme-context'
import { exportFileName, type Journal } from '@/journal/journal'
import type {
  AppIdentity,
  CalendarAccess,
  CalendarInfo,
  Desktop,
} from '@/platform/desktop'
import type { AppSettings } from '@/settings/app-settings'
import { describeTheme, isTheme, THEME_CHOICES } from '@/settings/theme'
import {
  describeUnavailableHotkey,
  hotkeyForKeystroke,
  type HotkeyStatus,
} from '@/settings/hotkey'
import { DEFAULT_SETTINGS } from '@/settings/settings'

/**
 * The things about the app the user gets to decide: the Hotkey, the Theme,
 * whether the app starts at login, whether today's meetings are imported — and
 * the way out of the SQLite file, which is an action rather than a setting.
 * The window behind this view is created on demand and genuinely closed on
 * dismiss, so the view loads once on mount and needs no reset — see
 * docs/adr/0002-capture-window-is-hidden-never-closed.md.
 */
export default function SettingsView({
  desktop,
  settings,
  journal,
}: {
  desktop: Desktop
  settings: AppSettings
  journal: Promise<Journal>
}) {
  const [startAtLogin, setStartAtLogin] = useState(DEFAULT_SETTINGS.startAtLogin)
  const [hotkey, setHotkey] = useState<HotkeyStatus | null>(null)
  // The reason the last remap was refused, if it was. Cleared by the next one.
  const [hotkeyProblem, setHotkeyProblem] = useState<string | null>(null)
  const [recording, setRecording] = useState(false)
  const [exported, setExported] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [appIdentity, setAppIdentity] = useState<AppIdentity | null>(null)
  const [importMeetings, setImportMeetings] = useState(
    DEFAULT_SETTINGS.importMeetings,
  )
  const [importCalendars, setImportCalendars] = useState<string[]>(
    DEFAULT_SETTINGS.importCalendars,
  )
  const [calendars, setCalendars] = useState<CalendarInfo[]>([])
  // Why Import is not on, when the reason is the OS rather than the user.
  // Nothing until there is something to say.
  const [calendarProblem, setCalendarProblem] = useState<string | null>(null)
  // The first-run question, asked once and never again — whichever way it is
  // answered. False until the store has been asked whether it was answered.
  const [asking, setAsking] = useState(false)
  // Read from the provider rather than loaded here: the Hotkey and every other
  // window can change the Theme too, and a second copy would drift from it.
  const { theme, resolved, setTheme } = useTheme()
  const page = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void desktop.appIdentity().then(setAppIdentity, (error: unknown) => {
      console.error('could not read the app identity', error)
    })
  }, [desktop])

  // Everything this window opens knowing, read once. What the OS allows is
  // asked every time rather than remembered — a grant is revoked in System
  // Settings without the app hearing of it, and a rebuilt release is a binary
  // macOS has never seen. This is the routine path rather than the exceptional
  // one: Import shows as off, the reason is said once, and nothing is asked of
  // the user. One read, because the stored settings and the OS answer decide
  // the same toggle between them, and two of these racing could leave it
  // reading on with the reason it is not underneath.
  useEffect(() => {
    // A Dock-less app does not reliably hand focus to a new window, and Escape
    // has to reach this view for the window to close.
    page.current?.focus()

    void (async () => {
      try {
        const [status, atLogin, answered, stored, access] = await Promise.all([
          desktop.hotkeyStatus(),
          desktop.startsAtLogin(),
          settings.hasBeenAskedAboutStartAtLogin(),
          settings.load(),
          desktop.calendarAccess(),
        ])
        setStartAtLogin(atLogin)
        setHotkey(status)
        setAsking(!answered)
        setImportMeetings(stored.importMeetings)
        setImportCalendars(stored.importCalendars)

        if (access === 'granted') {
          setCalendars(await desktop.calendars())
          setCalendarProblem(null)
          return
        }

        setCalendars([])
        // Only worth saying to someone who asked for Import: a user who has
        // never turned it on is owed no explanation for something they never
        // wanted, and the toggle says so for itself the moment they do. The
        // stored wish is the evidence, and it survives the permission going —
        // the sweep does not overwrite it, precisely so this can be said.
        setCalendarProblem(
          stored.importMeetings ? describeCalendarAccess(access) : null,
        )
      } catch (error) {
        console.error('could not read the settings', error)
      }
    })()
  }, [desktop, settings])

  useEffect(() => {
    if (!asking) return

    // Closing the window rather than choosing is an answer too, and the same
    // one: the app is not added to the login items. It has to be recorded, or
    // the question would return on every launch until it heard a yes.
    const closeRequested = desktop.onCloseRequested(() =>
      settings.saveStartAtLogin(false).catch((error: unknown) => {
        console.error('could not record the answer', error)
      }),
    )

    return () => {
      void closeRequested.then((stop) => stop())
    }
  }, [asking, desktop, settings])

  // Import as the window shows it: the user's wish, less whatever macOS is
  // withholding. The stored wish outlives a lost permission — that is what
  // makes the reason sayable — so the toggle is off whenever there is a reason
  // underneath it saying why.
  const importing = importMeetings && calendarProblem === null

  // Escape dismisses, and dismissing closes: Settings is not kept resident.
  // While the recorder is listening, Escape belongs to it — abandoning a
  // half-pressed combination must not take the window with it.
  function onKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape' && !recording && !asking) {
      void desktop.closeWindow()
    }
  }

  function toggleStartAtLogin(next: boolean) {
    setStartAtLogin(next)
    settings.saveStartAtLogin(next).catch((error: unknown) => {
      console.error('could not change the login item', error)
      setStartAtLogin(!next)
    })
  }

  /** The first-run answer, which is an answer either way. */
  function answerStartAtLogin(next: boolean) {
    setAsking(false)
    toggleStartAtLogin(next)
  }

  const remap = useCallback(
    (next: string) => {
      setRecording(false)
      desktop.setHotkey(next).then(
        (status) => {
          setHotkey(status)
          setHotkeyProblem(null)
        },
        (reason: unknown) => {
          setHotkeyProblem(describeUnavailableHotkey(next, String(reason)))
        },
      )
    },
    [desktop],
  )

  /**
   * Turning Import on is also where the calendar is asked for, because it is
   * the one moment the user has said they want it. Refused, it stays off and
   * says why — the app asks once here and never again on its own.
   */
  function toggleImport(next: boolean) {
    void (async () => {
      try {
        if (!next) {
          setImportMeetings(false)
          await settings.saveImportMeetings(false)
          return
        }

        const access =
          (await desktop.calendarAccess()) === 'granted'
            ? 'granted'
            : await desktop.requestCalendarAccess()

        if (access !== 'granted') {
          // The wish is kept, not discarded: the toggle reads off because the
          // reason underneath it says so, and a grant given in System Settings
          // later resumes Import without being asked for a second time.
          setImportMeetings(true)
          setCalendarProblem(describeCalendarAccess(access))
          await settings.saveImportMeetings(true)
          return
        }

        setImportMeetings(true)
        setCalendarProblem(null)
        setCalendars(await desktop.calendars())
        await settings.saveImportMeetings(true)
      } catch (error) {
        console.error('could not change how meetings are imported', error)
        setImportMeetings(!next)
      }
    })()
  }

  /** Ticking a calendar, or unticking it — an unticked one is ignored. */
  function toggleCalendar(id: string, ticked: boolean) {
    const next = ticked
      ? [...importCalendars, id]
      : importCalendars.filter((each) => each !== id)

    setImportCalendars(next)
    settings.saveImportCalendars(next).catch((error: unknown) => {
      console.error('could not change which calendars are imported', error)
      setImportCalendars(importCalendars)
    })
  }

  /** The whole journal, on disk and outside this app. */
  function exportAll() {
    setExporting(true)
    setExported(null)
    void (async () => {
      try {
        const digest = await (await journal).exportAll()
        const file = await desktop.exportNotes(
          digest.markdown,
          exportFileName(new Date()),
        )
        setExported(
          digest.noteCount === 0
            ? `Exported an empty journal to ${file.path}.`
            : `Exported ${digest.noteCount} Note${
                digest.noteCount === 1 ? '' : 's'
              } to ${file.path}.`,
        )
      } catch (error) {
        console.error('could not export the journal', error)
        setExported('Could not export the journal.')
      } finally {
        setExporting(false)
      }
    })()
  }

  return (
    <div
      ref={page}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="flex h-screen flex-col gap-6 overflow-y-auto bg-background px-6 py-5 type-body outline-none"
    >
      <Section
        title="Hotkey"
        explanation="The global combination that begins a Capture from anywhere."
      >
        <div className="flex items-center gap-3">
          <HotkeyRecorder
            recording={recording}
            hotkey={hotkey}
            onStart={() => {
              setRecording(true)
              setHotkeyProblem(null)
            }}
            onAbandon={() => setRecording(false)}
            onRecord={remap}
          />
        </div>

        {hotkey?.state === 'unavailable' && (
          <Problem>
            {describeUnavailableHotkey(hotkey.hotkey, hotkey.reason)}
          </Problem>
        )}
        {hotkeyProblem !== null && <Problem>{hotkeyProblem}</Problem>}

        <Aside>
          A combination another application has claimed globally will be refused
          here and reported. A combination an application uses only inside its
          own window cannot be detected — the Hotkey will simply take precedence
          there.
        </Aside>
      </Section>

      <Section
        title="Theme"
        explanation="Whether the app is light or dark, and whether it decides that for itself."
      >
        <label className="flex items-center gap-2 type-body">
          <span className="text-muted-foreground">Theme</span>
          <select
            value={theme}
            onChange={(event) => {
              // The picker only ever offers Themes; anything else is a bug
              // rather than a value to store.
              if (isTheme(event.target.value)) {
                setTheme(event.target.value)
              }
            }}
            className="rounded-md border border-border bg-transparent px-2 py-1 type-body text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
          >
            {THEME_CHOICES.map((choice) => (
              <option key={choice} value={choice}>
                {describeTheme(choice)}
              </option>
            ))}
          </select>
        </label>
        <Aside>
          {theme === 'system'
            ? `Following the system, which is currently ${resolved}. Cmd+Shift+D switches to the other one.`
            : `Cmd+Shift+D switches between light and dark from any window.`}
        </Aside>
      </Section>

      <Section
        title="Start at login"
        explanation="Whether Work Journal launches when you log in."
      >
        <label className="flex items-center gap-2 type-body">
          <input
            type="checkbox"
            checked={startAtLogin}
            onChange={(event) => toggleStartAtLogin(event.target.checked)}
            className="size-4 accent-foreground"
          />
          <span>Start Work Journal at login</span>
        </label>
      </Section>

      <Section
        title="Meetings"
        explanation="Today's meetings, added to the journal as they end. Never a backfill."
      >
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={importing}
            // Pressed, the box means the opposite of the wish rather than the
            // opposite of what it reads: with the permission gone it reads off
            // while the wish is on, and a press there is the user withdrawing
            // it — the reason underneath goes with it. Reading the box back
            // would ask to turn on what is already wished for, leaving no way
            // to change their mind.
            onChange={() => toggleImport(!importMeetings)}
            className="size-4 accent-foreground"
          />
          <span>Add today's meetings to the journal</span>
        </label>

        {calendarProblem !== null && <Problem>{calendarProblem}</Problem>}

        {importing && (
          <CalendarTicks
            calendars={calendars}
            ticked={importCalendars}
            onToggle={toggleCalendar}
          />
        )}

        <Aside>
          Imported meetings are ordinary Notes: reword them, file them under a
          Project, or delete them. Deleting one refuses that meeting for good —
          it is never added again. Declined meetings and all-day blocks are
          never added in the first place.
        </Aside>
      </Section>

      <Section
        title="Export"
        explanation="Every Note as Markdown, in your Downloads folder — nothing captured here is locked in."
      >
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={exportAll} disabled={exporting}>
            {exporting ? 'Exporting…' : 'Export all to Markdown'}
          </Button>
          <span role="status" aria-live="polite" className="type-meta text-muted-foreground">
            {exported}
          </span>
        </div>
      </Section>

      {appIdentity !== null && (
        <footer
          aria-label="Application version"
          className="mt-auto flex items-center justify-center gap-2 type-meta text-muted-foreground"
        >
          <span>{appIdentity.version}</span>
          {appIdentity.isDevelopment && (
            <Badge variant="outline">Dev</Badge>
          )}
        </footer>
      )}

      <FirstRunQuestion open={asking} onAnswer={answerStartAtLogin} />
    </div>
  )
}

/**
 * Why Import is not on, when the reason is macOS rather than the user. Both
 * answers are routine: a grant is keyed to the binary, so every rebuilt release
 * starts as one macOS has no record of.
 */
function describeCalendarAccess(access: Exclude<CalendarAccess, 'granted'>): string {
  return access === 'denied'
    ? 'macOS is not allowing Work Journal to read your calendars. Turn Calendars on for Work Journal in System Settings › Privacy & Security, then switch this back on.'
    : 'macOS has not been asked about your calendars — a rebuilt Work Journal is a new app as far as it is concerned. Meetings are not being imported; everything else in the journal is unaffected.'
}

/**
 * Which calendars an Import reads. None are ticked to begin with, because the
 * app cannot tell which of them mean work — a calendar nobody ticked is ignored
 * entirely rather than swept quietly.
 */
function CalendarTicks({
  calendars,
  ticked,
  onToggle,
}: {
  calendars: CalendarInfo[]
  ticked: string[]
  onToggle: (id: string, ticked: boolean) => void
}) {
  if (calendars.length === 0) {
    return <Aside>No calendars to read.</Aside>
  }

  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="sr-only">Calendars to import from</legend>
      {calendars.map((calendar) => (
        <label key={calendar.id} className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={ticked.includes(calendar.id)}
            onChange={(event) => onToggle(calendar.id, event.target.checked)}
            className="size-4 accent-foreground"
          />
          <span>{calendar.title}</span>
          <span className="text-xs text-muted-foreground">
            {calendar.source}
          </span>
        </label>
      ))}
    </fieldset>
  )
}

/**
 * The Hotkey as it stands, and the one way to change it: press the combination
 * rather than describe it, so what is recorded is what the OS will see.
 */
function HotkeyRecorder({
  recording,
  hotkey,
  onStart,
  onAbandon,
  onRecord,
}: {
  recording: boolean
  hotkey: HotkeyStatus | null
  onStart: () => void
  onAbandon: () => void
  onRecord: (hotkey: string) => void
}) {
  function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    // Every keystroke belongs to the recorder while it is listening, including
    // the ones the OS would otherwise act on.
    event.preventDefault()
    event.stopPropagation()

    if (event.key === 'Escape') {
      onAbandon()
      return
    }

    const next = hotkeyForKeystroke(event)
    // Null while only modifiers are down: the combination is not finished yet.
    if (next !== null) {
      onRecord(next)
    }
  }

  if (recording) {
    return (
      <button
        type="button"
        autoFocus
        onKeyDown={onKeyDown}
        onBlur={onAbandon}
        className="rounded-md border border-ring bg-transparent px-3 py-1.5 font-mono type-body text-foreground outline-none ring-2 ring-ring/30"
      >
        Press a combination…
      </button>
    )
  }

  return (
    <>
      <span className="rounded-md border border-border px-3 py-1.5 font-mono type-body">
        {hotkey?.hotkey ?? '…'}
      </span>
      <Button variant="outline" size="sm" onClick={onStart}>
        Change
      </Button>
    </>
  )
}

/**
 * The one question the app asks on its own, and it asks it once. Declining is
 * an answer: the app never adds itself to the login items uninvited, and never
 * asks again once told.
 */
function FirstRunQuestion({
  open,
  onAnswer,
}: {
  open: boolean
  onAnswer: (startAtLogin: boolean) => void
}) {
  return (
    <AlertDialog open={open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Start Work Journal at login?</AlertDialogTitle>
          <AlertDialogDescription>
            Work Journal lives in the menu bar and is only useful while it is
            running. It will not add itself to your login items unless you say
            so, and you can change this here at any time.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => onAnswer(false)}>
            Not now
          </AlertDialogCancel>
          <AlertDialogAction onClick={() => onAnswer(true)}>
            Start at login
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function Section({
  title,
  explanation,
  children,
}: {
  title: string
  explanation: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="type-section">{title}</h2>
      <p className="type-meta text-muted-foreground">{explanation}</p>
      {children}
    </section>
  )
}

/** Said plainly, and never in place of the setting it is about. */
function Problem({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="type-meta text-destructive">
      {children}
    </p>
  )
}

function Aside({ children }: { children: React.ReactNode }) {
  return <p className="type-meta text-muted-foreground">{children}</p>
}
