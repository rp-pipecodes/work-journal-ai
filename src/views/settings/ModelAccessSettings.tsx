import { useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useOnScreenToast } from '@/components/on-screen-toast'
import type { Desktop } from '@/platform/desktop'
import type { AppSettings } from '@/settings/app-settings'
import {
  apiKeyStatus,
  keychainRetryLabel,
  typeTheKeyAgainLine,
} from '@/settings/model-access'
import type { SettingsInitialState } from './SettingsInitialState'
import { useModelAccessState } from '@/components/model-access-state'
import {
  SettingsAside,
  SettingsGroup,
  SettingsProblem,
  SettingsRow,
  notStored,
} from './SettingsGroup'

/**
 * Whether the app can reach a language model at all: a Base URL, a Model name
 * and an API Key. The first two are ordinary settings and sit in the store
 * beside the rest; the Key is the only secret the app has and lives in the
 * macOS Keychain, reached through Rust and never handed back to this window —
 * see docs/adr/0026-the-api-key-lives-in-the-keychain-and-rust-makes-the-call.md.
 *
 * A field rather than a list of vendors, and free text rather than a fetched
 * list of models: any OpenAI-compatible endpoint is a Base URL, and a model
 * name baked into the app is a name that outlives the model.
 *
 * Everything this section does — the per-keystroke field saves, the Key's
 * trip to the Keychain, hearing the Onboarding flow's saves while it hides
 * under the flow — is the shared `useModelAccessState`; this group owns only
 * its own frame around it.
 */
export default function ModelAccessSettings({
  desktop,
  settings,
  initialSettings,
}: {
  desktop: Desktop
  settings: AppSettings
  initialSettings: Promise<SettingsInitialState | null> | null
}) {
  // The window's coordinated read seeds the fields once it lands, exactly as
  // it seeds every other group; a field the user typed into before it landed
  // keeps the keystrokes — the read may only seed what has not been touched.
  // See docs/adr/0028-the-initial-read-seeds-only-what-the-user-has-not-changed.md.
  const startStoredRead = useMemo(
    () =>
      initialSettings === null
        ? null
        : () =>
            initialSettings.then(
              (initial) =>
                initial === null
                  ? null
                  : {
                      modelBaseUrl: initial.stored.modelBaseUrl,
                      model: initial.stored.model,
                    },
            ),
    [initialSettings],
  )
  // The toasts this section raises for settled saves, replaced per field.
  const says = useOnScreenToast()
  const access = useModelAccessState({
    desktop,
    settings,
    askKeychainOnMount: true,
    startStoredRead,
    notify: says,
  })

  return (
    <SettingsGroup>
      <SettingsRow
        label="Base URL"
        explanation="Where the model is. Any OpenAI-compatible endpoint."
        controls="model-base-url"
        stacked
      >
        <Input
          id="model-base-url"
          className="w-full"
          value={access.modelBaseUrl}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => access.onBaseUrlChange(event.target.value)}
        />
      </SettingsRow>

      <SettingsRow
        label="Model"
        explanation="Which model to ask, in that endpoint's own words."
        controls="model"
        stacked
      >
        <Input
          id="model"
          className="w-full"
          value={access.model}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => access.onModelChange(event.target.value)}
        />
      </SettingsRow>

      <SettingsRow
        label="API Key"
        explanation="Kept in the macOS Keychain rather than in the settings file, and never shown again."
        controls="api-key"
        stacked
      >
        <Input
          id="api-key"
          type="password"
          className="w-full"
          value={access.typedKey}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => access.onTypeKey(event.target.value)}
        />
        <Button
          size="sm"
          disabled={access.typedKey.trim() === ''}
          onClick={access.saveKey}
        >
          Save
        </Button>
      </SettingsRow>

      {access.unsaved.modelBaseUrl && (
        <SettingsProblem>{notStored('Base URL')}</SettingsProblem>
      )}

      {access.unsaved.model && (
        <SettingsProblem>{notStored('Model')}</SettingsProblem>
      )}

      {access.keychainProblem !== null && (
        <SettingsProblem>
          {access.keychainProblem}{' '}
          {access.keychainRefusal === 'save' &&
          access.typedKey.trim() === '' ? (
            // The refusal survived a remount that did not keep the Key: a
            // retry would save nothing, so the user is told what to do
            // instead of being handed a no-op press.
            <span className="text-destructive">
              {typeTheKeyAgainLine()}
            </span>
          ) : (
            access.keychainRefusal !== null && (
              <Button
                variant="link"
                size="xs"
                aria-label={keychainRetryLabel(access.keychainRefusal)}
                onClick={access.retryKeychain}
              >
                Try again
              </Button>
            )
          )}
        </SettingsProblem>
      )}

      {/* Held back only until the Keychain has answered once: before that
          there is nothing truthful to say about a key nobody can see, and the
          line above says why. A call that fails after an answer is a different
          thing — the key is still known to be there, and Clear is the only way
          out of an entry that outlives an uninstall, so it stays put for the
          user to unlock the Keychain and press again. */}
      {access.keySet !== null && (
        <div className="flex items-center justify-between gap-6">
          <SettingsAside>{apiKeyStatus(access.keySet)}</SettingsAside>
          {access.keySet === true && (
            <Button variant="outline" size="sm" onClick={access.clearKey}>
              Clear
            </Button>
          )}
        </div>
      )}
    </SettingsGroup>
  )
}
