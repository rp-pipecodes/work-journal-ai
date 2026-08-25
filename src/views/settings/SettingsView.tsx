import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Kbd, KbdGroup } from '@/components/ui/kbd'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Toaster } from '@/components/ui/sonner'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
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
import WindowTitleBar from '@/components/WindowTitleBar'
import {
  describeExport,
  exportFileName,
  type Journal,
} from '@/journal/journal'
import type {
  AppIdentity,
  CalendarAccess,
  CalendarInfo,
  Desktop,
} from '@/platform/desktop'
import type { AppSettings } from '@/settings/app-settings'
import { isTheme, type Theme } from '@/settings/theme'
import {
  describeUnavailableHotkey,
  hotkeyForKeystroke,
  HOTKEY_ACTIONS,
  keysOfHotkey,
  type HotkeyAction,
  type HotkeyStatus,
  type HotkeyStatuses,
} from '@/settings/hotkey'
import { DEFAULT_SETTINGS } from '@/settings/settings'

/**
 * The Themes as a segmented control offers them: the two palettes first,
 * because they are what the user is choosing between, and deferring to the OS
 * last. Short labels, because each one sits inside a chip rather than a
 * sentence.
 */
const THEME_SEGMENTS: readonly { theme: Theme; label: string }[] = [
  { theme: 'light', label: 'Light' },
  { theme: 'dark', label: 'Dark' },
  { theme: 'system', label: 'System' },
]

/**
 * The things about the app the user gets to decide: the Hotkey, the Theme,
 * whether the app starts at login, whether today's meetings are imported — and
 * the way out of the SQLite file, which is an action rather than a setting.
 *
 * Laid out the way macOS lays settings out: what the setting is on the left,
 * the control that changes it on the right, and a separator wherever the
 * subject changes. Every control here is the app's own — a native widget
 * brings its own font, height and focus ring, and belongs to the OS rather
 * than to this window.
 *
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
  const [hotkeys, setHotkeys] = useState<HotkeyStatuses | null>(null)
  // The reason the last remap of each action was refused, if it was. Cleared by
  // the next one, and kept per action: a Task Hotkey the OS refused says
  // nothing about the Note Hotkey sitting above it.
  const [hotkeyProblem, setHotkeyProblem] = useState<
    Partial<Record<HotkeyAction, string>>
  >({})
  // Which recorder is listening, if either. One at a time: a keystroke can only
  // belong to one of them.
  const [recording, setRecording] = useState<HotkeyAction | null>(null)
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
        setHotkeys(status)
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
    if (event.key === 'Escape' && recording === null && !asking) {
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
    (action: HotkeyAction, next: string) => {
      setRecording(null)
      desktop.setHotkey(action, next).then(
        (status) => {
          setHotkeys(status)
          setHotkeyProblem((problems) => ({ ...problems, [action]: undefined }))
        },
        (reason: unknown) => {
          setHotkeyProblem((problems) => ({
            ...problems,
            [action]: describeUnavailableHotkey(action, next, String(reason)),
          }))
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

  /**
   * The whole journal, on disk and outside this app. The result is said twice
   * on purpose: a toast, which is where the user is looking, and the line
   * under the button, which is still there once the toast has gone.
   */
  function exportEverything() {
    setExporting(true)
    setExported(null)
    void (async () => {
      try {
        const exportedJournal = await (await journal).exportJournal()
        const file = await desktop.exportJournal(
          exportedJournal.markdown,
          exportFileName(new Date()),
        )
        const said = describeExport(exportedJournal, file.path)
        setExported(said)
        toast.success(said)
      } catch (error) {
        console.error('could not export the journal', error)
        const said = 'Could not export the journal.'
        setExported(said)
        toast.error(said)
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
      className="flex h-screen flex-col bg-background type-body outline-none"
    >
      <WindowTitleBar />

      {/* Everything the window says scrolls; the strip above it does not. The
          first row keeps the clear space it always had, measured from under
          the strip rather than from the top of the window. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pt-5 pb-5">
        <Group>
          {HOTKEY_ACTIONS.map(({ action, label, explanation }) => {
            const status = hotkeys?.[action] ?? null
            const refused = hotkeyProblem[action]

            return (
              <div key={action} className="flex flex-col gap-2">
                <Row label={label} explanation={explanation}>
                  <HotkeyRecorder
                    label={label}
                    recording={recording === action}
                    hotkey={status}
                    onStart={() => {
                      setRecording(action)
                      setHotkeyProblem((problems) => ({
                        ...problems,
                        [action]: undefined,
                      }))
                    }}
                    onAbandon={() => setRecording(null)}
                    onRecord={(next) => remap(action, next)}
                  />
                </Row>

                {status?.state === 'unavailable' && (
                  <Problem>
                    {describeUnavailableHotkey(
                      action,
                      status.hotkey,
                      status.reason,
                    )}
                  </Problem>
                )}
                {refused !== undefined && <Problem>{refused}</Problem>}
              </div>
            )
          })}

          <Aside>
            The two Hotkeys are independent, and may never be the same
            combination — one that is already the other will be refused here. A
            combination another application has claimed globally will be refused
            and reported too. A combination an application uses only inside its
            own window cannot be detected — the Hotkey will simply take
            precedence there.
          </Aside>
        </Group>

        <Separator />

        <Group>
          <Row
            label="Theme"
            explanation="Whether the app is light or dark, and whether it decides that for itself."
          >
            <ToggleGroup
              aria-labelledby="theme-heading"
              spacing={0}
              // A segmented control the way macOS draws one: one recessed track,
              // and the chosen segment raised out of it.
              className="gap-0 rounded-md bg-muted p-0.5"
              value={[theme]}
              onValueChange={(next) => {
                // Pressing the Theme already chosen deselects it, which is not a
                // Theme at all — the app is always painted as something, so
                // there is nothing to record.
                const chosen = next[0]
                if (isTheme(chosen)) {
                  setTheme(chosen)
                }
              }}
            >
              {THEME_SEGMENTS.map(({ theme: choice, label }) => (
                <ToggleGroupItem
                  key={choice}
                  value={choice}
                  className="rounded-sm! px-2.5 hover:bg-transparent data-pressed:bg-background data-pressed:text-foreground data-pressed:shadow-sm"
                >
                  {label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Row>

          <Aside>
            {theme === 'system'
              ? `Following the system, which is currently ${resolved}. Cmd+Shift+D switches to the other one.`
              : `Cmd+Shift+D switches between light and dark from any window.`}
          </Aside>
        </Group>

        <Separator />

        <Group>
          <Row
            label="Start at login"
            explanation="Whether Work Journal launches when you log in."
            controls="start-at-login"
          >
            <Switch
              id="start-at-login"
              checked={startAtLogin}
              onCheckedChange={toggleStartAtLogin}
            />
          </Row>
        </Group>

        <Separator />

        <Group>
          <Row
            label="Add today's meetings to the journal"
            explanation="Today's meetings, added to the journal as they end. Never a backfill."
            controls="import-meetings"
          >
            <Switch
              id="import-meetings"
              checked={importing}
              // Pressed, the switch means the opposite of the wish rather than
              // the opposite of what it reads: with the permission gone it reads
              // off while the wish is on, and a press there is the user
              // withdrawing it — the reason underneath goes with it. Reading the
              // switch back would ask to turn on what is already wished for,
              // leaving no way to change their mind.
              onCheckedChange={() => toggleImport(!importMeetings)}
            />
          </Row>

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
        </Group>

        <Separator />

        <Group>
          <Row
            label="Export"
            explanation="Every Note and Task as Markdown, in your Downloads folder — nothing kept here is locked in."
          >
            <Button variant="outline" size="sm" onClick={exportEverything} disabled={exporting}>
              {exporting ? 'Exporting…' : 'Export all to Markdown'}
            </Button>
          </Row>

          {/* The toast is where the user is looking; this is where the answer
              stays. It is here before there is anything to say, so that what it
              says next is announced rather than merely appearing. */}
          <p
            role="status"
            aria-live="polite"
            className="type-meta text-muted-foreground"
          >
            {exported}
          </p>
        </Group>

        {appIdentity !== null && (
          <>
            <Separator className="mt-auto" />
            <footer
              aria-label="Application version"
              className="flex items-center justify-center gap-2 py-3 type-meta text-muted-foreground"
            >
              <span>{appIdentity.version}</span>
              {appIdentity.isDevelopment && <Badge variant="outline">Dev</Badge>}
            </footer>
          </>
        )}

        <FirstRunQuestion open={asking} onAnswer={answerStartAtLogin} />
        <Toaster />
      </div>
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
    <fieldset className="flex flex-col gap-2 pl-1">
      <legend className="sr-only">Calendars to import from</legend>
      {calendars.map((calendar) => (
        <div key={calendar.id} className="flex items-center gap-2">
          <Checkbox
            id={`calendar-${calendar.id}`}
            checked={ticked.includes(calendar.id)}
            onCheckedChange={(next: boolean) => onToggle(calendar.id, next)}
          />
          <label htmlFor={`calendar-${calendar.id}`} className="type-meta">
            {calendar.title}
          </label>
          <span className="type-micro text-muted-foreground">
            {calendar.source}
          </span>
        </div>
      ))}
    </fieldset>
  )
}

/**
 * The Hotkey as it stands, and the one way to change it: press the combination
 * rather than describe it, so what is recorded is what the OS will see. It
 * reads as keys because that is what it is — one chip per key, in the order
 * they are held down.
 */
function HotkeyRecorder({
  label,
  recording,
  hotkey,
  onStart,
  onAbandon,
  onRecord,
}: {
  /** Which Hotkey this is, so the two recorders are told apart out loud. */
  label: string
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
        className="rounded-md border border-ring bg-transparent px-3 py-1.5 type-meta text-foreground outline-none ring-2 ring-ring/30"
      >
        Press a combination…
      </button>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <KbdGroup role="group" aria-label={`Current ${label}`}>
        {/* Nothing yet while the Rust side is still being asked. */}
        {(hotkey === null ? ['…'] : keysOfHotkey(hotkey.hotkey)).map((key) => (
          <Kbd key={key}>{key}</Kbd>
        ))}
      </KbdGroup>
      <Button variant="outline" size="sm" onClick={onStart} aria-label={`Change ${label}`}>
        Change
      </Button>
    </div>
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

/** Settings about one subject, between two separators. */
function Group({ children }: { children: React.ReactNode }) {
  return <section className="flex flex-col gap-2 py-4">{children}</section>
}

/**
 * One setting: what it is on the left, the control that changes it on the
 * right. The name of the setting stays a heading, because that is what it is —
 * a settings list is a document with sections, and a screen reader navigates
 * it as one. `controls` names the control's element inside that heading, so the
 * name is also the control's label rather than text that merely sits beside it.
 */
function Row({
  label,
  explanation,
  controls,
  children,
}: {
  label: string
  explanation: string
  controls?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-6">
      <div className="flex flex-col gap-0.5">
        <h2 id={`${headingId(label)}-heading`} className="type-section">
          {controls === undefined ? (
            label
          ) : (
            <label htmlFor={controls}>{label}</label>
          )}
        </h2>
        <p className="type-meta text-muted-foreground">{explanation}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2 pt-0.5">{children}</div>
    </div>
  )
}

/**
 * A Row's heading, named after the setting, so that a control which cannot
 * carry a `<label>` — a group of buttons is not a form field — can still point
 * at the words the user is reading as its own name.
 */
function headingId(label: string): string {
  return label.toLowerCase().replace(/[^a-z]+/g, '-')
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
