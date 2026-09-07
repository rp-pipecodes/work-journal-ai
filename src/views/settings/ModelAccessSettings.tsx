import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useOnScreenToast } from '@/components/on-screen-toast'
import type { Desktop } from '@/platform/desktop'
import type { AppSettings } from '@/settings/app-settings'
import { apiKeyStatus, keychainRefusedLine } from '@/settings/model-access'
import { DEFAULT_SETTINGS } from '@/settings/settings'
import type { SettingsInitialState } from './SettingsInitialState'
import { useSeededState } from './useSeededState'
import { saySettled } from './saySettled'
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
  // A field the user typed in before the read landed is already in the file
  // by the time it does, and seeding it would put the older value back under
  // the cursor. Each field seeds independently: typing in one never silences
  // the other.
  const [modelBaseUrl, setModelBaseUrl] = useSeededState(
    initialSettings,
    (initial) => initial.stored.modelBaseUrl,
    DEFAULT_SETTINGS.modelBaseUrl,
  )
  const [model, setModel] = useSeededState(
    initialSettings,
    (initial) => initial.stored.model,
    DEFAULT_SETTINGS.model,
  )
  // Whether the Keychain holds a key — never which key. Null until it has
  // answered, or while it is refusing to.
  const [keySet, setKeySet] = useState<boolean | null>(null)
  // The key being typed, on its way out of the window. Cleared the moment it
  // is saved: what the Keychain took is not this window's to keep.
  const [typedKey, setTypedKey] = useState('')
  // Why the Keychain is not answering, when it is not — in its own words, so
  // a locked keychain and a denied prompt do not read the same. Nothing until
  // there is something to say.
  const [keychainProblem, setKeychainProblem] = useState<string | null>(null)
  // Which fields the store would not take, one flag each: a write that
  // succeeded says nothing about the other field, and a line about Base URL
  // must not be answered by a keystroke in Model. Said rather than rolled
  // back: the field is text the user is still typing, and putting an older
  // value back under the cursor would throw away the keystrokes since.
  const [unsaved, setUnsaved] = useState({ modelBaseUrl: false, model: false })
  // A field saves on every keystroke into it, and the write is otherwise
  // silent; the toast with the field's name is where each save is heard. The
  // toast replaces itself rather than stacking — one per field, not one per
  // keystroke.
  const says = useOnScreenToast()
  // The refs the arriving announcement reads: a field the store refused must
  // not be overwritten by an older file value the announcement carries — the
  // refusal is what says the field is still the user's, not the file's.
  const unsavedRef = useRef(unsaved)
  useEffect(() => {
    unsavedRef.current = unsaved
  }, [unsaved])

  // Asked on its own rather than with the settings the store holds: a locked
  // Keychain is an ordinary answer here, and it must not take the rest of the
  // window's reading down with it.
  useEffect(() => {
    void desktop.apiKeySet().then(
      (set) => {
        setKeySet(set)
        setKeychainProblem(null)
      },
      (error: unknown) => {
        console.error('could not ask the Keychain about the API Key', error)
        refuseKeychain(error)
      },
    )
  }, [desktop])

  useEffect(() => {
    // A Model Access save landed — this group's own, or the Onboarding flow's.
    // The three answers are one fact, however many controls write it: the
    // flow may change them while this section is mounted but hidden, and the
    // section must hear of it without being rebuilt — that would throw away
    // what else the user has unsaved in Settings. The announcement is newer
    // than anything this group seeded, so it is applied as a change of its
    // own; a rollback still in flight from an earlier press is discarded by
    // the attempt that this starts. A field the store refused keeps its
    // refusal: the field is still the user's text, and the older value the
    // announcement would carry must not be put back under it.
    return settings.onModelAccessChanged(
      ({ modelBaseUrl: announcedBaseUrl, model: announcedModel, keySet: announcedKeySet }) => {
        if (!unsavedRef.current.modelBaseUrl) setModelBaseUrl(announcedBaseUrl)
        if (!unsavedRef.current.model) setModel(announcedModel)
        setKeySet(announcedKeySet)
        setKeychainProblem(null)
      },
    )
  }, [settings, setModel, setModelBaseUrl])

  /** The Keychain would not answer, and Settings says which one of it did. */
  function refuseKeychain(error: unknown): void {
    setKeychainProblem(keychainRefusedLine(error))
  }

  /** How the last write to one field went, and only that field. */
  function record(field: 'modelBaseUrl' | 'model', failed: boolean): void {
    setUnsaved((before) =>
      before[field] === failed ? before : { ...before, [field]: failed },
    )
  }

  function changeBaseUrl(next: string) {
    setModelBaseUrl(next)
    saySettled(says, settings.saveModelBaseUrl(next), {
      id: 'model-base-url',
      saved: 'Base URL saved.',
      couldNot: 'Could not save the Base URL.',
      what: 'could not change where the model is',
      onSaved: () => record('modelBaseUrl', false),
      onRefused: () => record('modelBaseUrl', true),
    })
  }

  function changeModel(next: string) {
    setModel(next)
    saySettled(says, settings.saveModel(next), {
      id: 'model',
      saved: 'Model saved.',
      couldNot: 'Could not save the Model.',
      what: 'could not change which model is asked',
      onSaved: () => record('model', false),
      onRefused: () => record('model', true),
    })
  }

  /** Hands the key to the Keychain, and forgets it here the moment it lands. */
  function saveKey() {
    const key = typedKey.trim()
    if (key === '') return

    saySettled(says, settings.saveApiKey(key), {
      id: 'api-key',
      saved: 'API Key saved.',
      couldNot: 'Could not save the API Key.',
      what: 'could not put the API Key in the Keychain',
      onSaved: () => {
        setTypedKey('')
        setKeySet(true)
        setKeychainProblem(null)
      },
      onRefused: refuseKeychain,
    })
  }

  /**
   * Takes the key out of the Keychain. A Keychain entry outlives an uninstall,
   * so this is the only way out of one.
   */
  function clearKey() {
    saySettled(says, settings.clearApiKey(), {
      id: 'api-key',
      saved: 'API Key removed.',
      couldNot: 'Could not remove the API Key.',
      what: 'could not take the API Key out of the Keychain',
      onSaved: () => {
        setKeySet(false)
        setKeychainProblem(null)
      },
      onRefused: refuseKeychain,
    })
  }

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
          value={modelBaseUrl}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => changeBaseUrl(event.target.value)}
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
          value={model}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => changeModel(event.target.value)}
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
          value={typedKey}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => setTypedKey(event.target.value)}
        />
        <Button size="sm" disabled={typedKey.trim() === ''} onClick={saveKey}>
          Save
        </Button>
      </SettingsRow>

      {unsaved.modelBaseUrl && <SettingsProblem>{notStored('Base URL')}</SettingsProblem>}

      {unsaved.model && <SettingsProblem>{notStored('Model')}</SettingsProblem>}

      {keychainProblem !== null && (
        <SettingsProblem>{keychainProblem}</SettingsProblem>
      )}

      {/* Held back only until the Keychain has answered once: before that
          there is nothing truthful to say about a key nobody can see, and the
          line above says why. A call that fails after an answer is a different
          thing — the key is still known to be there, and Clear is the only way
          out of an entry that outlives an uninstall, so it stays put for the
          user to unlock the Keychain and press again. */}
      {keySet !== null && (
        <div className="flex items-center justify-between gap-6">
          <SettingsAside>{apiKeyStatus(keySet)}</SettingsAside>
          {keySet === true && (
            <Button variant="outline" size="sm" onClick={clearKey}>
              Clear
            </Button>
          )}
        </div>
      )}
    </SettingsGroup>
  )
}
