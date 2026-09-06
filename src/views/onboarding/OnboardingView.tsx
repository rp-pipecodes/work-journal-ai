import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Kbd, KbdGroup } from '@/components/ui/kbd'
import { Switch } from '@/components/ui/switch'
import WindowTitleBar from '@/components/WindowTitleBar'
import type { Desktop } from '@/platform/desktop'
import type { AppSettings } from '@/settings/app-settings'
import {
  keysOfHotkey,
  HOTKEY_ACTIONS,
  type HotkeyStatuses,
} from '@/settings/hotkey'
import { DEFAULT_SETTINGS } from '@/settings/settings'

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
 * and the other setup steps between these two, so the flow is a short walk
 * over an ordered list rather than a fixed screen.
 */
export default function OnboardingView({
  desktop,
  settings,
  onDone,
}: {
  desktop: Desktop
  settings: AppSettings
  /** The user finished or deliberately skipped the whole flow. */
  onDone: () => void
}) {
  const [step, setStep] = useState<Step>('introduction')
  const [hotkeys, setHotkeys] = useState<HotkeyStatuses | null>(null)

  useEffect(() => {
    void desktop.hotkeyStatus().then(setHotkeys, (error: unknown) => {
      console.error('could not read the Hotkeys', error)
    })
  }, [desktop])

  if (step === 'introduction') {
    return (
      <OnboardingShell desktop={desktop}>
        <Introduction
          hotkeys={hotkeys}
          onContinue={() => setStep('start-at-login')}
          onSkip={onDone}
        />
      </OnboardingShell>
    )
  }

  return (
    <OnboardingShell desktop={desktop}>
      <StartAtLoginStep
        desktop={desktop}
        settings={settings}
        onBack={() => setStep('introduction')}
        onSkip={onDone}
        onOpenHistory={onDone}
      />
    </OnboardingShell>
  )
}

/** The step that follows the introduction in this build. */
type Step = 'introduction' | 'start-at-login'

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
  onContinue,
  onSkip,
}: {
  hotkeys: HotkeyStatuses | null
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

      <footer className="flex items-center justify-between gap-3 pt-2">
        <Button variant="ghost" onClick={onSkip}>
          Skip onboarding
        </Button>
        <Button onClick={onContinue}>Continue</Button>
      </footer>
    </>
  )
}

/**
 * The optional Start at Login step. It offers the same setting the Settings
 * section offers, through the same operating-system behaviour, so a choice
 * made here is the choice Settings reads — and replaying the flow later reads
 * back whatever was saved. A change is saved immediately; a refusal is said
 * plainly, offers a retry, and never blocks the way on.
 */
function StartAtLoginStep({
  desktop,
  settings,
  onBack,
  onSkip,
  onOpenHistory,
}: {
  desktop: Desktop
  settings: AppSettings
  onBack: () => void
  onSkip: () => void
  onOpenHistory: () => void
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
          <Button variant="ghost" onClick={onSkip}>
            Skip this step
          </Button>
        </div>
        <Button onClick={onOpenHistory}>Open History</Button>
      </footer>
    </>
  )
}
