import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { Desktop } from '@/platform/desktop'
import type { AppSettings } from '@/settings/app-settings'
import { DEFAULT_SETTINGS } from '@/settings/settings'
import type { SettingsInitialState } from './SettingsInitialState'
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
  const [modelBaseUrl, setModelBaseUrl] = useState(
    DEFAULT_SETTINGS.modelBaseUrl,
  )
  const [model, setModel] = useState(DEFAULT_SETTINGS.model)
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
  // Which of the two fields the user has already typed in. The settings file
  // opens while this window is on screen, so a whole Base URL can be typed
  // before the read lands — and a free-text field is where that gap shows in a
  // way a switch never does. What the user typed is already in the file by
  // then; seeding the field would put the older value back under the cursor
  // and leave the two disagreeing with nothing to say so.
  const typedIn = useRef({ modelBaseUrl: false, model: false })

  useEffect(() => {
    if (initialSettings === null) return

    void initialSettings.then((initial) => {
      if (initial === null) return

      // A field nobody has touched, and only that.
      if (!typedIn.current.modelBaseUrl) setModelBaseUrl(initial.stored.modelBaseUrl)
      if (!typedIn.current.model) setModel(initial.stored.model)
    })
  }, [initialSettings])

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
        refuse('could not ask the Keychain about the API Key', error)
      },
    )
  }, [desktop])

  /** The Keychain would not answer, and Settings says which one of it did. */
  function refuse(what: string, error: unknown): void {
    console.error(what, error)
    setKeychainProblem(`${KEYCHAIN_REFUSED} macOS said: ${saidBy(error)}`)
  }

  /** How the last write to one field went, and only that field. */
  function record(field: 'modelBaseUrl' | 'model', failed: boolean): void {
    setUnsaved((before) =>
      before[field] === failed ? before : { ...before, [field]: failed },
    )
  }

  function changeBaseUrl(next: string) {
    typedIn.current.modelBaseUrl = true
    setModelBaseUrl(next)
    settings.saveModelBaseUrl(next).then(
      () => record('modelBaseUrl', false),
      (error: unknown) => {
        console.error('could not change where the model is', error)
        record('modelBaseUrl', true)
      },
    )
  }

  function changeModel(next: string) {
    typedIn.current.model = true
    setModel(next)
    settings.saveModel(next).then(
      () => record('model', false),
      (error: unknown) => {
        console.error('could not change which model is asked', error)
        record('model', true)
      },
    )
  }

  /** Hands the key to the Keychain, and forgets it here the moment it lands. */
  function saveKey() {
    const key = typedKey.trim()
    if (key === '') return

    desktop.saveApiKey(key).then(
      () => {
        setTypedKey('')
        setKeySet(true)
        setKeychainProblem(null)
      },
      (error: unknown) => {
        refuse('could not put the API Key in the Keychain', error)
      },
    )
  }

  /**
   * Takes the key out of the Keychain. A Keychain entry outlives an uninstall,
   * so this is the only way out of one.
   */
  function clearKey() {
    desktop.clearApiKey().then(
      () => {
        setKeySet(false)
        setKeychainProblem(null)
      },
      (error: unknown) => {
        refuse('could not take the API Key out of the Keychain', error)
      },
    )
  }

  return (
    <SettingsGroup>
      <SettingsRow
        label="Base URL"
        explanation="Where the model is. Any OpenAI-compatible endpoint."
        controls="model-base-url"
      >
        <Input
          id="model-base-url"
          className="w-64"
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
      >
        <Input
          id="model"
          className="w-64"
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
      >
        <Input
          id="api-key"
          type="password"
          className="w-64"
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
          <SettingsAside>{keyStatus(keySet)}</SettingsAside>
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

/**
 * Whether there is a key, said rather than shown: what the Keychain holds is
 * never read back into this window. Only ever asked once the Keychain has
 * answered — there is no line for "still asking", because nothing of this is
 * on screen until then.
 */
function keyStatus(keySet: boolean): string {
  return keySet
    ? 'A key is saved in the Keychain. Saving another replaces it.'
    : 'No key is saved. Nothing reaches a model until there is one.'
}

/**
 * A locked Keychain, or a prompt the user denied. Routine rather than broken —
 * the same treatment Meeting Import gives a refused calendar grant — and every
 * other setting in this window carries on working.
 */
const KEYCHAIN_REFUSED =
  'macOS is not letting Work Journal reach your Keychain, so the API Key cannot be read or changed. Unlock your login keychain in Keychain Access, or allow Work Journal when macOS asks, and open Settings again.'

/**
 * What the far side said, whichever side that was: a Tauri command rejects
 * with the string Rust returned, and the suite throws an Error.
 */
function saidBy(error: unknown): string {
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message
  return String(error)
}
