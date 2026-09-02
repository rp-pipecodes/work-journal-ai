import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useOnScreenToast } from '@/components/on-screen-toast'
import type {
  AvailableUpdate,
  Desktop,
  UpdateProgress,
} from '@/platform/desktop'
import { SettingsGroup, SettingsRow } from './SettingsGroup'

/**
 * The way out of this version and into the next one, without leaving the app.
 * Two presses rather than one — look, then install — because a download that
 * started itself is a download nobody agreed to, and because the version being
 * installed is worth naming before it replaces the one running.
 *
 * Nothing here runs on a timer: the app looks when it is asked to. See
 * docs/adr/0030-the-app-updates-itself-from-its-own-releases.md.
 */
export default function UpdateSettings({ desktop }: { desktop: Desktop }) {
  // The release the last look found, and the one the install button installs.
  // Null both before anything has been looked for and when this build is the
  // latest — which of the two is what the line underneath says.
  const [found, setFound] = useState<AvailableUpdate | null>(null)
  const [busy, setBusy] = useState<'checking' | 'installing' | null>(null)
  const [progress, setProgress] = useState<UpdateProgress | null>(null)
  // What the line under the button keeps saying once the toast has faded — the
  // same saying-twice an Export gets, for the same reason: a check finishes
  // after the press, and the answer has to outlive it.
  const [said, setSaid] = useState<string | null>(null)
  const says = useOnScreenToast()

  /** Looks once, and says either the version waiting or that there is none. */
  function checkForUpdate() {
    setBusy('checking')
    setSaid(null)
    void (async () => {
      try {
        const update = await desktop.checkForUpdate()
        setFound(update)
        const answer =
          update === null
            ? 'Work Journal is up to date.'
            : `Work Journal ${update.version} is available.`
        setSaid(answer)
        says.success(answer)
      } catch (error) {
        console.error('could not check for updates', error)
        const answer = 'Could not check for updates.'
        setSaid(answer)
        says.failure(answer)
      } finally {
        setBusy(null)
      }
    })()
  }

  /**
   * Installs what was found and restarts into it. The restart takes this
   * webview with it, so the success line is only ever read in the moment
   * between the two — and by anyone whose restart did not happen.
   */
  function installUpdate() {
    if (found === null) return

    setBusy('installing')
    setSaid(null)
    setProgress(null)
    void (async () => {
      try {
        await desktop.installUpdate(setProgress)
        const answer = `Work Journal ${found.version} is installed. Restarting…`
        setSaid(answer)
        says.success(answer)
      } catch (error) {
        console.error('could not install the update', error)
        const answer = `Could not install Work Journal ${found.version}.`
        setSaid(answer)
        says.failure(answer)
      } finally {
        setBusy(null)
        setProgress(null)
      }
    })()
  }

  return (
    <SettingsGroup>
      <SettingsRow
        label="Updates"
        explanation="Whether a newer Work Journal has been released, and moving to it from here rather than from a download."
      >
        {found === null ? (
          <Button
            variant="outline"
            size="sm"
            onClick={checkForUpdate}
            disabled={busy !== null}
          >
            {busy === 'checking' ? 'Checking…' : 'Check for updates'}
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={installUpdate}
            disabled={busy !== null}
          >
            {busy === 'installing'
              ? downloading(progress)
              : `Install ${found.version}`}
          </Button>
        )}
      </SettingsRow>

      {/* The toast is where the user is looking; this is where the answer
          stays. It is here before there is anything to say, so that what it
          says next is announced rather than merely appearing. */}
      <p
        role="status"
        aria-live="polite"
        className="type-meta text-muted-foreground"
      >
        {said}
      </p>
    </SettingsGroup>
  )
}

/**
 * The wait, in the terms the download reports it: a share of the whole where
 * the server said how big the whole is, and the bare fact of it where it did
 * not — a percentage nobody promised is a number that would go backwards.
 */
function downloading(progress: UpdateProgress | null): string {
  if (progress === null || progress.total === null || progress.total === 0) {
    return 'Downloading…'
  }

  return `Downloading… ${Math.round((progress.downloaded / progress.total) * 100)}%`
}
