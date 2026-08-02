import { useCallback, useEffect, useRef, useState } from 'react'
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
import type { Desktop } from '@/platform/desktop'
import type { AppSettings } from '@/settings/app-settings'
import { describeTheme, isTheme, THEME_CHOICES } from '@/settings/theme'
import {
  describeUnavailableHotkey,
  hotkeyForKeystroke,
  type HotkeyStatus,
} from '@/settings/hotkey'
import {
  DAY_START_HOURS,
  DEFAULT_SETTINGS,
  formatDayStartHour,
} from '@/settings/settings'

/**
 * The five things about the app the user gets to decide: the Day Start, the
 * Hotkey, the Theme, whether the app starts at login, and the way out of the
 * SQLite file. The window behind this view is created on demand and
 * genuinely closed on dismiss, so the view loads once on mount and needs no
 * reset — see docs/adr/0002-capture-window-is-hidden-never-closed.md.
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
  const [dayStartHour, setDayStartHour] = useState(DEFAULT_SETTINGS.dayStartHour)
  const [startAtLogin, setStartAtLogin] = useState(DEFAULT_SETTINGS.startAtLogin)
  const [hotkey, setHotkey] = useState<HotkeyStatus | null>(null)
  // The reason the last remap was refused, if it was. Cleared by the next one.
  const [hotkeyProblem, setHotkeyProblem] = useState<string | null>(null)
  const [recording, setRecording] = useState(false)
  const [exported, setExported] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  // The first-run question, asked once and never again — whichever way it is
  // answered. False until the store has been asked whether it was answered.
  const [asking, setAsking] = useState(false)
  // Read from the provider rather than loaded here: the Hotkey and every other
  // window can change the Theme too, and a second copy would drift from it.
  const { theme, resolved, setTheme } = useTheme()
  const page = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // A Dock-less app does not reliably hand focus to a new window, and Escape
    // has to reach this view for the window to close.
    page.current?.focus()

    void (async () => {
      try {
        const [stored, status, atLogin, answered] = await Promise.all([
          settings.load(),
          desktop.hotkeyStatus(),
          desktop.startsAtLogin(),
          settings.hasBeenAskedAboutStartAtLogin(),
        ])
        setDayStartHour(stored.dayStartHour)
        setStartAtLogin(atLogin)
        setHotkey(status)
        setAsking(!answered)
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

  // Escape dismisses, and dismissing closes: Settings is not kept resident.
  // While the recorder is listening, Escape belongs to it — abandoning a
  // half-pressed combination must not take the window with it.
  function onKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape' && !recording && !asking) {
      void desktop.closeWindow()
    }
  }

  function pickDayStart(hour: number) {
    setDayStartHour(hour)
    settings.saveDayStartHour(hour).catch((error: unknown) => {
      console.error('could not save the Day Start', error)
    })
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
      className="flex h-screen flex-col gap-6 overflow-y-auto bg-background px-6 py-5 outline-none"
    >
      <Section
        title="Day Start"
        explanation="The hour at which one day gives way to the next, so work done after midnight files under the day it felt like."
      >
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">A day begins at</span>
          <select
            value={dayStartHour}
            onChange={(event) => pickDayStart(Number(event.target.value))}
            className="rounded-md border border-border bg-transparent px-2 py-1 text-sm tabular-nums text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
          >
            {DAY_START_HOURS.map((hour) => (
              <option key={hour} value={hour}>
                {formatDayStartHour(hour)}
              </option>
            ))}
          </select>
        </label>
        <Aside>
          Changing this moves nothing already written down. A Note is filed once,
          when it is captured, and stays where it was filed.
        </Aside>
      </Section>

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
        <label className="flex items-center gap-2 text-sm">
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
            className="rounded-md border border-border bg-transparent px-2 py-1 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
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
        <label className="flex items-center gap-2 text-sm">
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
        title="Export"
        explanation="Every Note as Markdown, in your Downloads folder — nothing captured here is locked in."
      >
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={exportAll} disabled={exporting}>
            {exporting ? 'Exporting…' : 'Export all to Markdown'}
          </Button>
          <span role="status" aria-live="polite" className="text-xs text-muted-foreground">
            {exported}
          </span>
        </div>
      </Section>

      <FirstRunQuestion open={asking} onAnswer={answerStartAtLogin} />
    </div>
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
        className="rounded-md border border-ring bg-transparent px-3 py-1.5 font-mono text-sm text-foreground outline-none ring-2 ring-ring/30"
      >
        Press a combination…
      </button>
    )
  }

  return (
    <>
      <span className="rounded-md border border-border px-3 py-1.5 font-mono text-sm tabular-nums">
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
      <h2 className="text-sm font-medium">{title}</h2>
      <p className="text-xs text-muted-foreground">{explanation}</p>
      {children}
    </section>
  )
}

/** Said plainly, and never in place of the setting it is about. */
function Problem({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="text-xs text-destructive">
      {children}
    </p>
  )
}

function Aside({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>
}
