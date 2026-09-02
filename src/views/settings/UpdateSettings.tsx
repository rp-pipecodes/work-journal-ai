import { useEffect, useState } from 'react'
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
  // Where this group has got to, as one value rather than as flags that could
  // disagree: there is no such thing as checking while installing, and the
  // control reads its label off exactly this.
  const [stage, setStage] = useState<Stage>({ at: 'idle' })
  // What the line under the button keeps saying once the toast has faded — the
  // same saying-twice an Export gets, for the same reason: a check finishes
  // after the press, and the answer has to outlive it.
  const [said, setSaid] = useState<string | null>(null)
  const says = useOnScreenToast()

  /**
   * The restart, once the installed line has been on screen and not before. It
   * runs here rather than beside the install it follows because it takes this
   * webview with it: a state set and a process ended in the same breath is a
   * line nobody ever reads, which is exactly what this group promised to say.
   *
   * A commit is not a paint, and an effect is not the end of the wait. React
   * makes no promise that the browser has drawn anything by the time this
   * runs — an effect caused by an interaction may run before the paint — so
   * the restart waits two frames. The first callback runs before the next
   * paint, and the second only after that paint has happened, which is the
   * cheapest boundary that means "the user has had the chance to see it".
   *
   * Both frames are cancelled if this is torn down: the window can close in
   * the moment between the install and the paint, and ending the process from
   * under whoever opened one next is not this group's to do once nobody is
   * reading it.
   */
  useEffect(() => {
    if (stage.at !== 'installed') return

    const update = stage.update
    let painted = 0
    const committed = requestAnimationFrame(() => {
      painted = requestAnimationFrame(() => {
        desktop.restart().catch((error: unknown) => {
          console.error('could not restart into the update', error)
          // The install still took, so this is not a way back to the press
          // that made it: offering the install again would write the same
          // release over itself while the line says the opposite. What is
          // left is a quit, and the app cannot make it on the user's behalf.
          const answer = `Work Journal ${update.version} is installed. Quit and open it again to use it.`
          setStage({ at: 'quit-needed', update })
          setSaid(answer)
          says.failure(answer)
        })
      })
    })

    return () => {
      cancelAnimationFrame(committed)
      cancelAnimationFrame(painted)
    }
  }, [desktop, says, stage])

  /** Looks once, and says either the version waiting or that there is none. */
  function checkForUpdate() {
    setStage({ at: 'checking' })
    setSaid(null)
    void (async () => {
      try {
        const update = await desktop.checkForUpdate()
        setStage(
          update === null ? { at: 'idle' } : { at: 'found', update },
        )
        const answer =
          update === null
            ? 'Work Journal is up to date.'
            : `Work Journal ${update.version} is available.`
        setSaid(answer)
        says.success(answer)
      } catch (error) {
        console.error('could not check for updates', error)
        const answer = 'Could not check for updates.'
        setStage({ at: 'idle' })
        setSaid(answer)
        says.failure(answer)
      }
    })()
  }

  /**
   * Installs what was found. Says so, and only then does the effect above
   * restart into it — a failure leaves the release found, so the way to try
   * again is the same press rather than another look.
   */
  function installUpdate(update: AvailableUpdate) {
    setStage({ at: 'installing', update, progress: null })
    setSaid(null)
    void (async () => {
      try {
        await desktop.installUpdate((progress) => {
          setStage({ at: 'installing', update, progress })
        })
        const answer = `Work Journal ${update.version} is installed. Restarting…`
        setSaid(answer)
        says.success(answer)
        setStage({ at: 'installed', update })
      } catch (error) {
        console.error('could not install the update', error)
        const answer = `Could not install Work Journal ${update.version}.`
        setStage({ at: 'found', update })
        setSaid(answer)
        says.failure(answer)
      }
    })()
  }

  return (
    <SettingsGroup>
      <SettingsRow
        label="Updates"
        explanation="Whether a newer Work Journal has been released, and moving to it from here rather than from a download."
      >
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            if (stage.at === 'idle') checkForUpdate()
            else if (stage.at === 'found') installUpdate(stage.update)
          }}
          disabled={stage.at !== 'idle' && stage.at !== 'found'}
        >
          {label(stage)}
        </Button>
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
 * Where the group has got to. `idle` covers both "nothing has been looked for"
 * and "this build is the latest": the press is the same one either way, and
 * which of the two it is, is what the line underneath says.
 *
 * `installed` and `quit-needed` are both "the release is on disk"; they differ
 * in whether the app is on its way into it. Only the first is a stage anything
 * is still happening in, which is why the restart runs from the one and never
 * from the other.
 */
type Stage =
  | { at: 'idle' }
  | { at: 'checking' }
  | { at: 'found'; update: AvailableUpdate }
  | { at: 'installing'; update: AvailableUpdate; progress: UpdateProgress | null }
  | { at: 'installed'; update: AvailableUpdate }
  | { at: 'quit-needed'; update: AvailableUpdate }

/** What the one control says it will do, or is doing, at each stage. */
function label(stage: Stage): string {
  switch (stage.at) {
    case 'idle':
      return 'Check for updates'
    case 'checking':
      return 'Checking…'
    case 'found':
      return `Install ${stage.update.version}`
    case 'installing':
      return downloading(stage.progress)
    case 'installed':
      return 'Restarting…'
    case 'quit-needed':
      return 'Installed'
  }
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
