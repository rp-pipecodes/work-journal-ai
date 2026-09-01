import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { DEFAULT_STANDUP_PROMPT } from '@/journal/standup-post'
import type { AppSettings } from '@/settings/app-settings'
import type { SettingsInitialState } from './SettingsInitialState'
import { SettingsGroup, SettingsProblem, SettingsRow, notStored } from './SettingsGroup'

/**
 * The system prompt a Standup Post is written under, as the user's — plain
 * text in the settings file beside the rest, because a prompt is voice rather
 * than a secret. It lives here rather than beside the post it produced:
 * editing a prompt next to one day's post invites tuning it against that day,
 * which is how you end up with a prompt that only works on Tuesdays.
 *
 * Empty means the default, not silence. A cleared field is written as the
 * empty string, `readSettings` reads it back as the shipped prompt, and a
 * model is never asked under an empty system prompt — see issue #133.
 */
export default function StandupPromptSettings({
  settings,
  initialSettings,
}: {
  settings: AppSettings
  initialSettings: Promise<SettingsInitialState | null> | null
}) {
  // The prompt as it stands, starting at the shipped one. Seeded from the
  // stored value by the same coordinated read every group shares, and never
  // over what the user has already typed.
  const [standupPrompt, setStandupPrompt] = useState(DEFAULT_STANDUP_PROMPT)
  // Whether the store would not take the last write. Said rather than rolled
  // back: the field is text the user is still typing, and putting an older
  // value back under the cursor would throw away the keystrokes since.
  const [unsaved, setUnsaved] = useState(false)
  const typedIn = useRef(false)

  useEffect(() => {
    if (initialSettings === null) return

    void initialSettings.then((initial) => {
      if (initial === null) return

      // A field nobody has touched, and only that.
      if (!typedIn.current) setStandupPrompt(initial.stored.standupPrompt)
    })
  }, [initialSettings])

  function change(next: string) {
    typedIn.current = true
    setStandupPrompt(next)
    settings.saveStandupPrompt(next).then(
      () => setUnsaved(false),
      (error: unknown) => {
        console.error('could not change the Standup Prompt', error)
        setUnsaved(true)
      },
    )
  }

  /**
   * The shipped prompt back, whatever the field holds now. An explicit action
   * rather than a keystroke, so it also counts as the user having spoken: a
   * read still on its way must not seed an older value over it.
   */
  function restoreDefault() {
    typedIn.current = true
    setStandupPrompt(DEFAULT_STANDUP_PROMPT)
    settings.saveStandupPrompt(DEFAULT_STANDUP_PROMPT).then(
      () => setUnsaved(false),
      (error: unknown) => {
        console.error('could not restore the Standup Prompt', error)
        setUnsaved(true)
      },
    )
  }

  return (
    <SettingsGroup>
      <SettingsRow
        label="Standup Prompt"
        explanation="What a Standup Post is written under. Left empty, the shipped prompt is used — a model is never asked nothing."
        controls="standup-prompt"
      >
        <div className="flex w-96 flex-col items-end gap-2">
          <Textarea
            id="standup-prompt"
            className="w-full"
            value={standupPrompt}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => change(event.target.value)}
          />
          <Button variant="outline" size="sm" onClick={restoreDefault}>
            Restore Default
          </Button>
        </div>
      </SettingsRow>

      {unsaved && (
        <SettingsProblem>{notStored('Standup Prompt')}</SettingsProblem>
      )}
    </SettingsGroup>
  )
}