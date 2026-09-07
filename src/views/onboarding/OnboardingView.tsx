import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Kbd, KbdGroup } from '@/components/ui/kbd'
import { Switch } from '@/components/ui/switch'
import WindowTitleBar from '@/components/WindowTitleBar'
import type { CalendarAccess, CalendarInfo, Desktop } from '@/platform/desktop'
import type { AppSettings } from '@/settings/app-settings'
import {
  keysOfHotkey,
  HOTKEY_ACTIONS,
  type HotkeyStatuses,
} from '@/settings/hotkey'
import { DEFAULT_SETTINGS } from '@/settings/settings'
import {
  CalendarTicks,
} from '@/views/settings/meeting-import-shared'
import { describeCalendarAccess } from '@/views/settings/calendar-access'

/**
 * The guided Onboarding flow, shown inside the Main Window — see
 * docs/onboarding.md. It introduces capturing a Note and finding it again,
 * shows the Hotkeys that actually apply, and offers the optional setup the
 * running build has. Each step's choices are saved the moment they are made
 * and kept in this view for the life of the window, so Back shows what the
 * user just chose and replay shows what was saved before. Nothing here is a
 * second owner of any setting: the controls reach the same `AppSettings` the
 * Settings section does.
 *
 * The steps themselves come and go: the sibling tickets add optional practice
 * and the remaining setup steps around these, so the flow is a short walk
 * over an ordered list rather than a fixed screen. The order is introduction
 * and optional practice → Start at Login → Meeting Import → Model Access
 * (once its ticket lands) → Finish in History.
 */
export default function OnboardingView({
  desktop,
  settings,
  onDone,
  onViewNote,
}: {
  desktop: Desktop
  settings: AppSettings
  /** The user finished or deliberately skipped the whole flow. */
  onDone: () => void
  /** The user asked to see the practice Note they saved, in History. */
  onViewNote: (journalDay: string) => void
}) {
  const [step, setStep] = useState<Step>('introduction')
  const [hotkeys, setHotkeys] = useState<HotkeyStatuses | null>(null)
  // The practice attempt, as one fact with one owner. Each Try it replaces it
  // wholesale: a new attempt id, open, and no Note recorded yet. The attempt
  // closes on the Capture window's explicit outcome alone — submitted with
  // the Note's day, or cancelled with nothing created — never on focus
  // arriving, so a submission and the focus that follows it cannot race.
  // Practice is optional, and nothing about continuing requires a Note.
  const [practice, setPractice] = useState<Practice>({
    attempt: 0,
    open: false,
    day: null,
  })
  const practiceRef = useRef(practice)

  /** Replaces the attempt in both places event handlers read. */
  function setPracticeState(next: Practice) {
    practiceRef.current = next
    setPractice(next)
  }

  useEffect(() => {
    void desktop.hotkeyStatus().then(setHotkeys, (error: unknown) => {
      console.error('could not read the Hotkeys', error)
    })
  }, [desktop])

  useEffect(() => {
    // How the practice attempt ended, as the Capture window reports it. Heard
    // only while its own attempt is open, so a Capture from anywhere else —
    // before the first Try it, after a cancellation, after a save — never
    // stands in for practice.
    const subscription = desktop.onPracticeEnded((ended) => {
      const current = practiceRef.current
      if (!current.open) return
      setPracticeState({
        attempt: current.attempt,
        open: false,
        day: ended.outcome === 'submitted' ? ended.journalDay : null,
      })
    })

    return () => {
      void subscription.then((stop) => stop())
    }
  }, [desktop])

  /** Opens the real Capture window without leaving the flow. */
  function tryPractice() {
    const current = practiceRef.current
    if (current.open) {
      // The attempt is already open but its window was put away for something
      // else: raise it again under the same attempt rather than starting over.
      void desktop.beginPracticeCapture().catch((error: unknown) => {
        console.error('could not open Capture for practice', error)
      })
      return
    }
    const previous = current
    const next: Practice = {
      attempt: current.attempt + 1,
      open: true,
      day: null,
    }
    setPracticeState(next)
    void desktop.beginPracticeCapture().catch((error: unknown) => {
      console.error('could not open Capture for practice', error)
      // The window never opened, so this attempt never began: go back to
      // what was there before it, but only if nothing has moved on since.
      if (practiceRef.current.attempt === next.attempt) {
        setPracticeState({ ...previous, open: false })
      }
    })
  }

  if (step === 'introduction') {
    return (
      <OnboardingShell desktop={desktop}>
        <Introduction
          hotkeys={hotkeys}
          practicing={practice.open}
          savedDay={practice.day}
          onTryIt={tryPractice}
          onViewNote={() => {
            const day = practiceRef.current.day
            if (day !== null) onViewNote(day)
          }}
          onContinue={() => setStep('start-at-login')}
          onSkip={onDone}
        />
      </OnboardingShell>
    )
  }

  if (step === 'start-at-login') {
    return (
      <OnboardingShell desktop={desktop}>
        <StartAtLoginStep
          desktop={desktop}
          settings={settings}
          onBack={() => setStep('introduction')}
          onNext={() => setStep('meeting-import')}
          onSkipOnboarding={onDone}
        />
      </OnboardingShell>
    )
  }

  return (
    <OnboardingShell desktop={desktop}>
      <MeetingImportStep
        desktop={desktop}
        settings={settings}
        onBack={() => setStep('start-at-login')}
        onSkipStep={onDone}
        onSkipOnboarding={onDone}
        onOpenHistory={onDone}
      />
    </OnboardingShell>
  )
}

/**
 * The optional setup steps in walking order. Model Access joins after
 * Meeting Import once its ticket lands; until then Meeting Import is the last
 * available setup step and finishes directly in History.
 */
type Step = 'introduction' | 'start-at-login' | 'meeting-import'

/**
 * One practice attempt. Replaced wholesale on every Try it, so no flag from
 * an earlier attempt — or from no practice at all — can be read by a later
 * event. `open` is whether the Capture window is out for this attempt; `day`
 * is the submitted Note's Journal Day once one has arrived.
 */
interface Practice {
  attempt: number
  open: boolean
  day: string | null
}

/**
 * The window chrome around the flow: the strip the traffic lights sit in and
 * the scrollable panel holding the current step. The flow takes the room the
 * sections would, so the sidebar and the window behave exactly as they do for
 * a section — including being draggable from the strip.
 */
function OnboardingShell({
  desktop,
  children,
}: {
  desktop: Desktop
  children: React.ReactNode
}) {
  const page = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Escape belongs to the step the way it belongs to a section: this root
    // takes focus as the flow appears, and the buttons are a Tab away.
    page.current?.focus()
  }, [])

  return (
    <div
      ref={page}
      tabIndex={-1}
      onKeyDown={(event) => {
        // A step owns Escape, as the sections do: nothing is being typed
        // here, so it closes the window — which, for automatic Onboarding,
        // is the dismissal closing always is.
        if (event.key === 'Escape') void desktop.closeWindow()
      }}
      className="flex min-w-0 flex-1 flex-col bg-background outline-none"
    >
      <WindowTitleBar />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center gap-6 px-8 py-6">
          {children}
        </div>
      </div>
    </div>
  )
}

function Introduction({
  hotkeys,
  practicing,
  savedDay,
  onTryIt,
  onViewNote,
  onContinue,
  onSkip,
}: {
  hotkeys: HotkeyStatuses | null
  /** Whether the practice Capture is open right now. */
  practicing: boolean
  /** The Journal Day of the practice Note, once one has been saved. */
  savedDay: string | null
  onTryIt: () => void
  onViewNote: () => void
  onContinue: () => void
  onSkip: () => void
}) {
  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="type-title">Welcome to Work Journal</h1>
        <p className="type-body text-muted-foreground">
          A short, dated line for everything you did, and the Tasks you owe.
          Notes and Tasks work right away — no calendar, no model, nothing to
          set up.
        </p>
      </header>

      <section aria-label="Start from anywhere" className="flex flex-col gap-2">
        <h2 className="type-section">
          Start a Note or a Task from anywhere
        </h2>
        {HOTKEY_ACTIONS.map(({ action, label, explanation }) => {
          const combination = hotkeys?.[action] ?? null
          return (
            <div
              key={action}
              className="flex items-center justify-between gap-4 rounded-md border border-border px-3 py-2"
            >
              <div className="flex flex-col gap-0.5">
                <span className="type-meta text-muted-foreground">
                  {explanation}
                </span>
                <span className="sr-only">{label}</span>
              </div>
              <KbdGroup role="group" aria-label={`Current ${label}`}>
                {(combination === null
                  ? ['…']
                  : keysOfHotkey(combination.hotkey)
                ).map((key) => (
                  <Kbd key={key}>{key}</Kbd>
                ))}
              </KbdGroup>
            </div>
          )
        })}
        <p className="type-meta text-muted-foreground">
          If a shortcut is unavailable, the Work Journal icon in the menu bar
          always offers New Note and New Task.
        </p>
      </section>

      <section aria-label="Find it again in History" className="flex flex-col gap-1">
        <h2 className="type-section">Read everything back in History</h2>
        <p className="type-body text-muted-foreground">
          History is the notebook in the sidebar: every Note sits under the
          day it was written, ready to copy into a standup or find again
          later.
        </p>
      </section>

      <section aria-label="Try capturing a Note" className="flex flex-col gap-2">
        <h2 className="type-section">Try capturing a Note</h2>
        <p className="type-body text-muted-foreground">
          Optional — trying it opens the real Capture window, and nothing is
          required to continue. A Note you save becomes part of the journal;
          cancelling creates nothing.
        </p>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            onClick={onTryIt}
            disabled={practicing}
          >
            Try it
          </Button>
        </div>
        <p aria-live="polite" className="type-meta min-h-4 text-muted-foreground">
          {practicing && 'The Capture window is open — saving or cancelling returns here.'}
          {!practicing && savedDay !== null && 'Saved — your Note is in the journal.'}
        </p>
      </section>

      <footer className="flex items-center justify-between gap-3 pt-2">
        <Button variant="ghost" onClick={onSkip}>
          Skip onboarding
        </Button>
        {savedDay === null ? (
          <Button onClick={onContinue}>Continue</Button>
        ) : (
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={onViewNote}>
              View your note
            </Button>
            <Button onClick={onContinue}>Continue setup</Button>
          </div>
        )}
      </footer>
    </>
  )
}

/**
 * The optional Start at Login step. It offers the same setting the Settings
 * section offers, through the same operating-system behaviour, so a choice
 * made here is the choice Settings reads — and replaying the flow later reads
 * back whatever was saved. A change is saved immediately; a refusal is said
 * plainly, offers a retry, and never blocks the way on to Meeting Import.
 */
function StartAtLoginStep({
  desktop,
  settings,
  onBack,
  onNext,
  onSkipOnboarding,
}: {
  desktop: Desktop
  settings: AppSettings
  onBack: () => void
  /** The walk advances to Meeting Import, skipped or not. */
  onNext: () => void
  /** The whole flow is deliberately dismissed. */
  onSkipOnboarding: () => void
}) {
  // Seeded from the login item the OS reports, which is what the setting is
  // really stored as; a refusal rolls back to a fresh read of the same.
  const [wish, setWish] = useState(DEFAULT_SETTINGS.startAtLogin)
  // What the step is saying right now: nothing, saving, saved, or refused.
  const [outcome, setOutcome] = useState<
    | { state: 'idle' }
    | { state: 'saving' }
    | { state: 'saved'; on: boolean }
    | { state: 'refused'; wanted: boolean }
  >({ state: 'idle' })
  // The one press that silences the arriving read, exactly as the seeded
  // settings state does: a change made before the OS answers must not be put
  // back by the answer.
  const touched = useRef(false)
  // How many changes have been started since this step mounted. A save that
  // settles — or a rollback read that returns — belongs to the change that
  // started it, and is discarded if a newer one has begun by then: the same
  // per-attempt rule the seeded Settings switch lives under — see
  // docs/adr/0028-the-initial-read-seeds-only-what-the-user-has-not-changed.md.
  const attempts = useRef(0)

  useEffect(() => {
    void desktop.startsAtLogin().then((current) => {
      if (touched.current) return
      setWish(current)
    })
  }, [desktop])

  /** Starts a change, in flight or not: every press and every retry lands here. */
  function toggle(next: boolean) {
    touched.current = true
    const attempt = ++attempts.current
    setWish(next)
    setOutcome({ state: 'saving' })
    settings.saveStartAtLogin(next).then(
      () => {
        if (attempts.current !== attempt) return
        setOutcome({ state: 'saved', on: next })
      },
      (error: unknown) => {
        console.error('could not change the login item', error)
        if (attempts.current !== attempt) return
        setOutcome({ state: 'refused', wanted: next })
        // Roll back to what the OS says now: the login item is changed before
        // the file is written, and the switch must agree with the OS. The
        // read belongs to this attempt too, so a slower answer cannot undo a
        // change that has since been started.
        void desktop.startsAtLogin().then(
          (current) => {
            if (attempts.current === attempt) setWish(current)
          },
          () => {
            if (attempts.current === attempt) setWish(!next)
          },
        )
      },
    )
  }

  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="type-title">Start Work Journal at login?</h1>
        <p className="type-body text-muted-foreground">
          Work Journal lives in the menu bar and is only useful while it is
          running. Starting it at login is optional, and you can change it any
          time in Settings.
        </p>
      </header>

      <div className="flex items-center justify-between gap-6 rounded-md border border-border px-3 py-2">
        <div className="flex flex-col gap-0.5">
          <h2 id="onboarding-start-at-login-heading" className="type-section">
            <label htmlFor="onboarding-start-at-login">Start at login</label>
          </h2>
          <p className="type-meta text-muted-foreground">
            Whether Work Journal launches when you log in.
          </p>
        </div>
        <Switch
          id="onboarding-start-at-login"
          checked={wish}
          disabled={outcome.state === 'saving'}
          onCheckedChange={toggle}
        />
      </div>

      <p aria-live="polite" className="type-meta min-h-4 text-muted-foreground">
        {outcome.state === 'saved' &&
          (outcome.on
            ? 'Saved — Work Journal will start at login.'
            : 'Saved — Work Journal will not start at login.')}
        {outcome.state === 'refused' && (
          <span className="text-destructive" role="alert">
            Could not change whether Work Journal starts at login.{' '}
            <Button
              variant="link"
              size="xs"
              aria-label="Try saving the Start at Login choice again"
              onClick={() => toggle(outcome.wanted)}
            >
              Try again
            </Button>
          </span>
        )}
      </p>

      <footer className="flex items-center justify-between gap-3 pt-2">
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={onBack}>
            Back
          </Button>
          <Button variant="ghost" onClick={onNext}>
            Skip this step
          </Button>
          <Button variant="ghost" onClick={onSkipOnboarding}>
            Skip onboarding
          </Button>
        </div>
        <Button onClick={onNext}>Continue</Button>
      </footer>
    </>
  )
}

/**
 * The optional Meeting Import step. It offers the same Import the Settings
 * section offers, through the same calendar-permission path and the same
 * saves, so a choice made here is the choice Settings reads — and replaying
 * the flow later reads back whatever was saved. Nothing here asks macOS for
 * anything: turning Import on is the one moment the calendar is asked for,
 * exactly as in Settings, so entering or replaying the step never prompts on
 * the user's behalf.
 *
 * A change is saved immediately; a refusal, an empty selection, and a failed
 * save are each said plainly, offer a retry or recovery, and never block the
 * way on. This is the last available setup step until the Model Access ticket
 * lands, so continuing finishes directly in History.
 */
function MeetingImportStep({
  desktop,
  settings,
  onBack,
  onSkipStep,
  onSkipOnboarding,
  onOpenHistory,
}: {
  desktop: Desktop
  settings: AppSettings
  onBack: () => void
  /** The walk finishes, skipped or not: this is the last setup step. */
  onSkipStep: () => void
  /** The whole flow is deliberately dismissed. */
  onSkipOnboarding: () => void
  onOpenHistory: () => void
}) {
  // The wish for Import and the ticked calendars, seeded from what the file
  // holds — the same answers Settings reads. A refusal rolls back to a fresh
  // read of the same file, so the ticks always agree with it.
  const [wish, setWish] = useState(DEFAULT_SETTINGS.importMeetings)
  const [ticked, setTicked] = useState<string[]>(
    DEFAULT_SETTINGS.importCalendars,
  )
  // The calendars macOS holds today, fetched once permission is known to be
  // granted — never as part of asking for it.
  const [calendars, setCalendars] = useState<CalendarInfo[]>([])
  // Why Import is not on, when the reason is the OS rather than the user.
  // Nothing until there is something to say.
  const [calendarProblem, setCalendarProblem] = useState<string | null>(null)
  // What a save refused, when the reason is the file rather than the OS: the
  // toggle's wish and what it wanted, or the ticks and what they wanted.
  // Nothing until a save says otherwise.
  const [saveProblem, setSaveProblem] = useState<
    | { kind: 'import'; wanted: boolean }
    | { kind: 'calendars'; wanted: string[] }
    | null
  >(null)
  // The one press that silences the arriving read, exactly as the seeded
  // settings state does: a change made before the file answers must not be
  // put back by the answer.
  const touched = useRef(false)
  // How many Import changes and calendar changes have been started since this
  // step mounted. A save that settles — or a rollback read that returns —
  // belongs to the change that started it, and is discarded if a newer one
  // has begun by then: the same per-attempt rule the seeded Settings controls
  // live under — see
  // docs/adr/0028-the-initial-read-seeds-only-what-the-user-has-not-changed.md.
  const importAttempts = useRef(0)
  const calendarAttempts = useRef(0)

  useEffect(() => {
    // The saved answers, read back without asking macOS for anything new:
    // `calendarAccess` only reports what the OS allows, and the calendars are
    // fetched only over an answer already granted. Entering or replaying the
    // step therefore never prompts.
    void settings.load().then(
      (stored) => {
        if (touched.current) return
        setWish(stored.importMeetings)
        setTicked(stored.importCalendars)
        void desktop.calendarAccess().then(
          (access) => {
            if (touched.current) return
            if (access === 'granted') {
              void desktop.calendars().then(setCalendars, (error: unknown) => {
                console.error('could not read the calendars', error)
              })
              setCalendarProblem(null)
              return
            }
            setCalendars([])
            // Only worth saying to someone who asked for Import: a user who
            // has never turned it on is owed no explanation for something they
            // never wanted. The stored wish is the evidence, and it survives
            // the permission going — precisely so this can be said.
            setCalendarProblem(
              stored.importMeetings ? describeCalendarAccess(access) : null,
            )
          },
          (error: unknown) => {
            console.error('could not read the calendar permission', error)
          },
        )
      },
      (error: unknown) => {
        console.error('could not read the saved Import', error)
      },
    )
  }, [desktop, settings])

  // Import as the step shows it: the user's wish, less whatever macOS is
  // withholding. The stored wish outlives a lost permission — that is what
  // makes the reason sayable — so the switch is off whenever there is a
  // reason underneath it saying why.
  const importing = wish && calendarProblem === null
  // What the saved selection names today, for the configured line.
  const chosen = calendars
    .filter((calendar) => ticked.includes(calendar.id))
    .map((calendar) => calendar.title)

  /**
   * Saving the wish, wherever the press that wanted it came from: the switch,
   * a retry, or the permission path below. A refusal is said with what was
   * wanted — the retry behaves like a fresh press — and rolls back to what
   * the file holds now: the file is what a save is, so only its refusal can
   * arrive after a change took. The rollback belongs to this change: a newer
   * press that landed while it was in flight is not undone by it.
   */
  function persistWish(wanted: boolean, attempt: number) {
    void settings.saveImportMeetings(wanted).then(
      () => {},
      (error: unknown) => {
        console.error('could not change how meetings are imported', error)
        if (importAttempts.current !== attempt) return
        setSaveProblem({ kind: 'import', wanted })
        void settings.load().then(
          (stored) => {
            if (importAttempts.current === attempt) {
              setWish(stored.importMeetings)
            }
          },
          () => {
            if (importAttempts.current === attempt) setWish(!wanted)
          },
        )
      },
    )
  }

  /**
   * Turning Import on is also where the calendar is asked for, because it is
   * the one moment the user has said they want it — the same path the
   * Settings switch walks. Refused, the wish stays on and says why: a grant
   * given in System Settings later resumes Import without being asked for a
   * second time.
   */
  function toggleImport(next: boolean) {
    touched.current = true
    const attempt = ++importAttempts.current
    setSaveProblem(null)
    if (!next) {
      setWish(false)
      setCalendarProblem(null)
      persistWish(false, attempt)
      return
    }

    void (async () => {
      let access: CalendarAccess
      try {
        access =
          (await desktop.calendarAccess()) === 'granted'
            ? 'granted'
            : await desktop.requestCalendarAccess()
      } catch (error) {
        console.error('could not ask macOS about the calendars', error)
        if (importAttempts.current !== attempt) return
        setSaveProblem({ kind: 'import', wanted: true })
        return
      }
      if (importAttempts.current !== attempt) return

      if (access !== 'granted') {
        setWish(true)
        setCalendarProblem(describeCalendarAccess(access))
        persistWish(true, attempt)
        return
      }

      setWish(true)
      setCalendarProblem(null)
      try {
        // The calendars over the answer just won, as the Settings switch
        // fetches them: an unreadable calendar store refuses the change the
        // same way a refused file write does, rather than leaving Import on
        // with nothing to select.
        setCalendars(await desktop.calendars())
      } catch (error) {
        console.error('could not read the calendars', error)
        if (importAttempts.current !== attempt) return
        setSaveProblem({ kind: 'import', wanted: true })
        void settings.load().then(
          (stored) => {
            if (importAttempts.current === attempt) {
              setWish(stored.importMeetings)
            }
          },
          () => {
            if (importAttempts.current === attempt) setWish(false)
          },
        )
        return
      }
      if (importAttempts.current !== attempt) return
      persistWish(true, attempt)
    })()
  }

  /**
   * Saving the ticks, wherever the press that wanted them came from: a tick,
   * or its retry. A refusal is said with what was wanted and rolls back to
   * what the file holds now, so the ticks agree with it whatever the refused
   * press moved. The rollback belongs to this change: a newer tick that
   * landed while the re-read was in flight is not undone by it.
   */
  function saveCalendars(next: string[], attempt: number) {
    void settings.saveImportCalendars(next).then(
      () => {},
      (error: unknown) => {
        console.error('could not change which calendars are imported', error)
        if (calendarAttempts.current !== attempt) return
        setSaveProblem({ kind: 'calendars', wanted: next })
        void settings.load().then(
          (stored) => {
            if (calendarAttempts.current === attempt) {
              setTicked(stored.importCalendars)
            }
          },
          () => {
            if (calendarAttempts.current === attempt) setTicked(ticked)
          },
        )
      },
    )
  }

  /** Ticking a calendar, or unticking it — an unticked one is ignored. */
  function toggleCalendar(id: string, next: boolean) {
    touched.current = true
    const attempt = ++calendarAttempts.current
    const updated = next
      ? [...ticked, id]
      : ticked.filter((each) => each !== id)
    setTicked(updated)
    setSaveProblem(null)
    saveCalendars(updated, attempt)
  }

  /** Retrying a refused tick save: the refused selection, saved afresh. */
  function retryCalendars(wanted: string[]) {
    touched.current = true
    const attempt = ++calendarAttempts.current
    setTicked(wanted)
    setSaveProblem(null)
    saveCalendars(wanted, attempt)
  }

  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="type-title">Add today&apos;s meetings to the journal?</h1>
        <p className="type-body text-muted-foreground">
          Today&apos;s meetings, added to the journal as they end — never a
          backfill. Import is optional, and you can change it any time in
          Settings. Notes and Tasks work without it.
        </p>
      </header>

      <div className="flex items-center justify-between gap-6 rounded-md border border-border px-3 py-2">
        <div className="flex flex-col gap-0.5">
          <h2 id="onboarding-import-meetings-heading" className="type-section">
            <label htmlFor="onboarding-import-meetings">
              Add today&apos;s meetings to the journal
            </label>
          </h2>
          <p className="type-meta text-muted-foreground">
            Today&apos;s meetings, added to the journal as they end. Never a
            backfill.
          </p>
        </div>
        <Switch
          id="onboarding-import-meetings"
          checked={importing}
          // Pressed, the switch means the opposite of the wish rather than
          // the opposite of what it reads: with the permission gone it reads
          // off while the wish is on, and a press there is the user
          // withdrawing it — the same rule the Settings switch lives under.
          onCheckedChange={() => toggleImport(!wish)}
        />
      </div>

      {calendarProblem !== null && (
        <p className="type-meta text-destructive" role="alert">
          {calendarProblem}{' '}
          <Button
            variant="link"
            size="xs"
            aria-label="Try allowing calendar access again"
            onClick={() => toggleImport(true)}
          >
            Try again
          </Button>
        </p>
      )}

      {saveProblem?.kind === 'import' && (
        <p className="type-meta text-destructive" role="alert">
          Could not change how meetings are imported.{' '}
          <Button
            variant="link"
            size="xs"
            aria-label="Try saving Import again"
            onClick={() => toggleImport(saveProblem.wanted)}
          >
            Try again
          </Button>
        </p>
      )}

      {saveProblem?.kind === 'calendars' && (
        <p className="type-meta text-destructive" role="alert">
          Could not save which calendars to import.{' '}
          <Button
            variant="link"
            size="xs"
            aria-label="Try saving the calendars again"
            onClick={() => retryCalendars(saveProblem.wanted)}
          >
            Try again
          </Button>
        </p>
      )}

      {importing && (
        <>
          <CalendarTicks
            calendars={calendars}
            ticked={ticked}
            onToggle={toggleCalendar}
          />
          {ticked.length === 0 ? (
            <p className="type-meta text-muted-foreground">
              No calendars selected — permission alone imports nothing. Tick
              the calendars that mean work, or continue without Import.
            </p>
          ) : (
            <p
              aria-live="polite"
              className="type-meta min-h-4 text-muted-foreground"
            >
              Today&apos;s meetings from{' '}
              {chosen.length > 0
                ? chosen.join(', ')
                : 'your selected calendars'}{' '}
              will be imported.
            </p>
          )}
        </>
      )}

      {!importing && calendarProblem === null && saveProblem === null && (
        <p
          aria-live="polite"
          className="type-meta min-h-4 text-muted-foreground"
        >
          Meeting Import is off — Notes and Tasks work without it.
        </p>
      )}

      <footer className="flex items-center justify-between gap-3 pt-2">
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={onBack}>
            Back
          </Button>
          <Button variant="ghost" onClick={onSkipStep}>
            Skip this step
          </Button>
          <Button variant="ghost" onClick={onSkipOnboarding}>
            Skip onboarding
          </Button>
        </div>
        <Button onClick={onOpenHistory}>Open History</Button>
      </footer>
    </>
  )
}
