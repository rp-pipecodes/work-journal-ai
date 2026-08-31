import { useEffect, useState } from 'react'
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
import { useOnScreen } from '@/components/on-screen-context'
import { Switch } from '@/components/ui/switch'
import type { Desktop } from '@/platform/desktop'
import type { AppSettings } from '@/settings/app-settings'
import { DEFAULT_SETTINGS } from '@/settings/settings'
import type { SettingsInitialState } from './SettingsInitialState'
import { SettingsGroup, SettingsRow } from './SettingsGroup'

/** The start-at-login preference, including its first-run question. */
export default function StartAtLoginSettings({
  desktop,
  settings,
  initialSettings,
}: {
  desktop: Desktop
  settings: AppSettings
  initialSettings: Promise<SettingsInitialState | null>
}) {
  const [startAtLogin, setStartAtLogin] = useState(DEFAULT_SETTINGS.startAtLogin)
  // The first-run question, asked once and never again — whichever way it is
  // answered. False until the store has been asked whether it was answered.
  const [asking, setAsking] = useState(false)
  // Whether this view is the one on screen. The question is portalled out of
  // whatever is hiding this setting, so only the visible section may show it.
  const onScreen = useOnScreen()

  useEffect(() => {
    void initialSettings.then((initial) => {
      if (initial === null) return
      setStartAtLogin(initial.startAtLogin)
      setAsking(!initial.startAtLoginAnswered)
    })
  }, [initialSettings])

  useEffect(() => {
    if (!asking) return

    // Closing the window rather than choosing is an answer too, and the same
    // one: the app is not added to the login items. It has to be recorded, or
    // the question would return on every launch until it heard a yes. Listened
    // for whether or not this view is the one on screen: the question is
    // unanswered wherever the user left the window, and closing it from
    // another section is the same silence.
    const closeRequested = desktop.onCloseRequested(() =>
      settings.saveStartAtLogin(false).catch((error: unknown) => {
        console.error('could not record the answer', error)
      }),
    )

    return () => {
      void closeRequested.then((stop) => stop())
    }
  }, [asking, desktop, settings])

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

  return (
    <>
      <SettingsGroup>
        <SettingsRow
          label="Start at login"
          explanation="Whether Work Journal launches when you log in."
          controls="start-at-login"
        >
          <Switch
            id="start-at-login"
            checked={startAtLogin}
            onCheckedChange={toggleStartAtLogin}
          />
        </SettingsRow>
      </SettingsGroup>

      <FirstRunQuestion
        open={onScreen && asking}
        onAnswer={answerStartAtLogin}
      />
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
      <AlertDialogContent onKeyDown={(event) => event.stopPropagation()}>
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
