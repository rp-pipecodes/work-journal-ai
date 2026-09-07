import { useEffect, useRef, useState } from 'react'
import type { OnScreenToast } from './on-screen-toast'
import type { Desktop } from '@/platform/desktop'
import type { AppSettings } from '@/settings/app-settings'
import {
  keychainRefusedLine,
  type KeychainRefusal,
} from '@/settings/model-access'
import { DEFAULT_SETTINGS } from '@/settings/settings'

/**
 * The one Model Access behaviour both places that offer it run on — the
 * Settings section and the Onboarding flow's step. They share this hook so
 * the parts of Model Access that are facts rather than chrome live once:
 * the per-keystroke field saves and their refused-field flags, the Key's
 * trip to the Keychain and what the Keychain says back, the retry of each
 * refusal, and the hearing of the other surface's saves (both surfaces are
 * mounted at once — the section hidden under the flow — so each must hear
 * the other without being rebuilt, which would throw away what the user has
 * unsaved). The two places differ only in what frames those facts: seeding
 * from their own read, and the words around them.
 *
 * A field saves on every keystroke into it, exactly as the Settings fields
 * always have. Each field seeds from the arriving read only until a keystroke
 * has touched it — see
 * docs/adr/0028-the-initial-read-seeds-only-what-the-user-has-not-changed.md.
 * The Key itself never travels on the announcement the hook hears: only
 * whether the Keychain holds one.
 */
export function useModelAccessState({
  desktop,
  settings,
  /** How this mount starts, before any read lands — what the flow kept from
   * an earlier mount of its step, or nothing at all. */
  seed,
  /** Whether this mount asks the Keychain whether a Key is saved. The step
   * skips it when it resumes answers the flow already read; the section never
   * does. */
  askKeychainOnMount,
  /** Starts the read the fields seed from — the settings the window opened
   * with, or the file read back for a fresh mount of the step. Null when this
   * mount has nothing to read (a resumed step). Called from an effect, never
   * from render, so opening the store stays post-commit work. */
  startStoredRead,
  /** Called once this mount's reads have settled, whichever way each went —
   * the flow marks its kept answers seeded here, so Back in the gap re-reads
   * rather than resuming nothing. Not called for a mount with no reads. */
  onInitialSettled,
  /** The toasts a Settings window raises for settled saves. The step raises
   * none: its alerts are its words. */
  notify,
}: {
  desktop: Desktop
  settings: AppSettings
  seed?: ModelAccessSeed | null
  askKeychainOnMount: boolean
  startStoredRead: (() => Promise<ModelAccessSeeded | null>) | null
  onInitialSettled?: () => void
  notify?: OnScreenToast | null
}): ModelAccessState {
  // The two ordinary fields, and the Key being typed on its way out of the
  // window. The Key is cleared the moment it is saved: what the Keychain took
  // is not this surface's to keep.
  const [modelBaseUrl, setModelBaseUrl] = useState(
    () => seed?.modelBaseUrl ?? DEFAULT_SETTINGS.modelBaseUrl,
  )
  const [model, setModel] = useState(
    () => seed?.model ?? DEFAULT_SETTINGS.model,
  )
  const [typedKey, setTypedKey] = useState('')
  // Whether the Keychain holds a key — never which key. Null until it has
  // answered, or while it is refusing to.
  const [keySet, setKeySet] = useState<boolean | null>(
    () => seed?.keySet ?? null,
  )
  // Why the Keychain is not answering, when it is not — in its own words, so
  // a locked keychain and a denied prompt do not read the same.
  const [keychainProblem, setKeychainProblem] = useState<string | null>(
    () => seed?.keychainProblem ?? null,
  )
  // Which Keychain action the refusal refused, so its Try again behaves like
  // the press again: a fresh read, a fresh save, or a fresh clear.
  const [keychainRefusal, setKeychainRefusal] = useState<KeychainRefusal | null>(
    () => seed?.keychainRefusal ?? null,
  )
  // Which fields the store would not take, one flag each: a write that
  // succeeded says nothing about the other field, and a line about Base URL
  // must not be answered by a keystroke in Model. Said rather than rolled
  // back: the field is text the user is still typing, and putting an older
  // value back under the cursor would throw away the keystrokes since.
  const [unsaved, setUnsaved] = useState<{ modelBaseUrl: boolean; model: boolean }>(
    () => seed?.unsaved ?? { modelBaseUrl: false, model: false },
  )

  // A keystroke into a field silences that field's seed — the same rule the
  // seeded Settings controls live under, per value rather than per surface.
  const baseUrlTouched = useRef(false)
  const modelTouched = useRef(false)
  // The flags the arriving announcement reads: a field the store refused must
  // not be overwritten by a value the announcement carries — the refusal is
  // what says the field is still the user's, not the store's.
  const unsavedRef = useRef(unsaved)
  useEffect(() => {
    unsavedRef.current = unsaved
  }, [unsaved])

  // Read afresh each render, called once the reads this mount started have
  // settled: the flow marks its kept answers seeded there, and the callback
  // itself is not a dependency of the read effect, so a fresh identity does
  // not restart the reads.
  const onInitialSettledRef = useRef(onInitialSettled)
  useEffect(() => {
    onInitialSettledRef.current = onInitialSettled
  }, [onInitialSettled])

  // Whether each of this mount's reads has settled, and whether the settled
  // word has already been said. A mount owns up to two reads — whether the
  // Keychain holds a Key, and the fields' saved answers — and each tracks
  // itself, because they can start apart: a Settings window publishes its
  // coordinated read from an effect, so the stored read can arrive after the
  // Keychain has already answered. Asking the Keychain lives in an effect of
  // its own, keyed on nothing that arrives later, so it is asked once.
  const keychainSettledRef = useRef(!askKeychainOnMount)
  const storedSettledRef = useRef(startStoredRead === null)
  const settleSaidRef = useRef(false)

  /**
   * Says this mount's reads have settled, once every read it owns has — a
   * mount that leaves before its reads settle (Back in the gap) never marks
   * its kept answers seeded, so the next mount re-reads rather than resuming
   * answers that never came.
   */
  function maybeSaySettled(): void {
    if (!keychainSettledRef.current || !storedSettledRef.current) return
    if (settleSaidRef.current) return
    settleSaidRef.current = true
    onInitialSettledRef.current?.()
  }

  useEffect(() => {
    if (!askKeychainOnMount) return
    let alive = true
    // Asked on its own rather than with the settings the store holds: a
    // locked Keychain is an ordinary answer here, and it must not take the
    // rest of the read down with it.
    keychainSettledRef.current = false
    void desktop.apiKeySet().then(
      (set) => {
        if (!alive) return
        setKeySet(set)
        setKeychainProblem(null)
        setKeychainRefusal(null)
        keychainSettledRef.current = true
        maybeSaySettled()
      },
      (error: unknown) => {
        if (!alive) return
        console.error('could not ask the Keychain about the API Key', error)
        refuseKeychain('read', error)
        keychainSettledRef.current = true
        maybeSaySettled()
      },
    )
    return () => {
      alive = false
    }
  }, [askKeychainOnMount, desktop])

  useEffect(() => {
    if (startStoredRead === null) return
    let alive = true
    // The saved answers, read back and seeded per field only until a
    // keystroke has touched that field — the same rule the seeded Settings
    // controls live under. See
    // docs/adr/0028-the-initial-read-seeds-only-what-the-user-has-not-changed.md.
    storedSettledRef.current = false
    void Promise.resolve(startStoredRead()).then(
      (stored) => {
        if (!alive || stored === null) return
        if (!baseUrlTouched.current) setModelBaseUrl(stored.modelBaseUrl)
        if (!modelTouched.current) setModel(stored.model)
        storedSettledRef.current = true
        maybeSaySettled()
      },
      (error: unknown) => {
        if (!alive) return
        console.error('could not read the saved Model Access', error)
        storedSettledRef.current = true
        maybeSaySettled()
      },
    )
    return () => {
      alive = false
    }
  }, [startStoredRead])

  useEffect(() => {
    // A Model Access save landed — this surface's own, or the other's. The
    // two surfaces are one fact the writes share, however many controls make
    // it: a choice saved by the flow must reach the mounted section without
    // it being rebuilt. The save says only the part it wrote: a field's value
    // is applied unless that field is still the user's (its store refused);
    // a Key answer means the Keychain was reached and the refusal — if one
    // was showing — is over. A field save never carries a Key answer, so a
    // keystroke can never wipe a live Keychain refusal, and a field the
    // store refused keeps its text rather than the older value the
    // announcement would put back under it.
    return settings.onModelAccessChanged((change) => {
      if ('modelBaseUrl' in change) {
        if (!unsavedRef.current.modelBaseUrl) {
          setModelBaseUrl(change.modelBaseUrl)
        }
        return
      }
      if ('model' in change) {
        if (!unsavedRef.current.model) setModel(change.model)
        return
      }
      setKeySet(change.keySet)
      setKeychainProblem(null)
      setKeychainRefusal(null)
    })
  }, [settings])

  /** The Keychain would not answer, and the surface says which action refused. */
  function refuseKeychain(what: KeychainRefusal, error: unknown): void {
    setKeychainRefusal(what)
    setKeychainProblem(keychainRefusedLine(error))
  }

  /** Asking the Keychain afresh, as the retry of a refused read does. */
  function askKeychain(): void {
    void desktop.apiKeySet().then(
      (set) => {
        setKeySet(set)
        setKeychainProblem(null)
        setKeychainRefusal(null)
      },
      (error: unknown) => {
        console.error('could not ask the Keychain about the API Key', error)
        refuseKeychain('read', error)
      },
    )
  }

  /** How a settled field save went, said where this surface says things. */
  function sayField(
    field: 'modelBaseUrl' | 'model',
    saved: boolean,
  ): void {
    if (notify === undefined || notify === null) return
    const [name, id] =
      field === 'modelBaseUrl'
        ? (['Base URL', 'model-base-url'] as const)
        : (['Model', 'model'] as const)
    if (saved) {
      notify.success(`${name} saved.`, id)
    } else {
      notify.failure(`Could not save the ${name}.`, id)
    }
  }

  /**
   * Saving one of the two ordinary fields, and saying whether it took. A
   * refusal never rolls the field back: it is text the user is still typing.
   * Its announcement is the settings core's to make, after the write lands.
   */
  function saveField(field: 'modelBaseUrl' | 'model', next: string): void {
    const saving =
      field === 'modelBaseUrl'
        ? settings.saveModelBaseUrl(next)
        : settings.saveModel(next)
    saving.then(
      () => {
        setUnsaved((before) =>
          before[field] ? { ...before, [field]: false } : before,
        )
        sayField(field, true)
      },
      (error: unknown) => {
        console.error(
          field === 'modelBaseUrl'
            ? 'could not change where the model is'
            : 'could not change which model is asked',
          error,
        )
        setUnsaved((before) =>
          before[field] ? before : { ...before, [field]: true },
        )
        sayField(field, false)
      },
    )
  }

  /** A field saves on every keystroke into it. */
  function changeBaseUrl(next: string): void {
    baseUrlTouched.current = true
    setModelBaseUrl(next)
    saveField('modelBaseUrl', next)
  }

  function changeModel(next: string): void {
    modelTouched.current = true
    setModel(next)
    saveField('model', next)
  }

  /** The retry of a refused field save: its current text, saved afresh. */
  function retryField(field: 'modelBaseUrl' | 'model'): void {
    if (field === 'modelBaseUrl') {
      baseUrlTouched.current = true
      saveField('modelBaseUrl', modelBaseUrl)
      return
    }
    modelTouched.current = true
    saveField('model', model)
  }

  /**
   * Hands the key to the Keychain, and forgets it here the moment it lands.
   * A refused save keeps the typed Key under the cursor — it is still the
   * user's, on its way out — so its retry can behave like the press again.
   */
  function saveKey(): void {
    const key = typedKey.trim()
    if (key === '') return

    void settings.saveApiKey(key).then(
      () => {
        setTypedKey('')
        setKeySet(true)
        setKeychainProblem(null)
        setKeychainRefusal(null)
        notify?.success('API Key saved.', 'api-key')
      },
      (error: unknown) => {
        console.error('could not put the API Key in the Keychain', error)
        refuseKeychain('save', error)
        notify?.failure('Could not save the API Key.', 'api-key')
      },
    )
  }

  /**
   * Takes the key out of the Keychain. A Keychain entry outlives an uninstall,
   * so this is the only way out of one. A call that fails after an answer is a
   * different thing from a mount that never got one: the key is still known
   * to be there, so Clear stays put for the user to unlock the Keychain and
   * press again.
   */
  function clearKey(): void {
    void settings.clearApiKey().then(
      () => {
        setKeySet(false)
        setKeychainProblem(null)
        setKeychainRefusal(null)
        notify?.success('API Key removed.', 'api-key')
      },
      (error: unknown) => {
        console.error('could not take the API Key out of the Keychain', error)
        refuseKeychain('clear', error)
        notify?.failure('Could not remove the API Key.', 'api-key')
      },
    )
  }

  /** The retry of a refused Keychain call, behaving like the press again. */
  function retryKeychain(): void {
    if (keychainRefusal === 'save') {
      saveKey()
      return
    }
    if (keychainRefusal === 'clear') {
      clearKey()
      return
    }
    askKeychain()
  }

  return {
    modelBaseUrl,
    model,
    typedKey,
    keySet,
    keychainProblem,
    keychainRefusal,
    unsaved,
    onTypeKey: setTypedKey,
    onBaseUrlChange: changeBaseUrl,
    onModelChange: changeModel,
    retryBaseUrl: () => retryField('modelBaseUrl'),
    retryModel: () => retryField('model'),
    saveKey,
    clearKey,
    askKeychain,
    retryKeychain,
  }
}

/**
 * How a mount of a Model Access surface starts: what the flow kept from an
 * earlier mount of its step, or nothing at all. The typed Key is never part
 * of it — what the Keychain holds is not a surface's to keep, and the Key
 * being typed stays only under the cursor it was typed into.
 */
export interface ModelAccessSeed {
  modelBaseUrl?: string
  model?: string
  keySet?: boolean | null
  keychainProblem?: string | null
  keychainRefusal?: KeychainRefusal | null
  unsaved?: { modelBaseUrl: boolean; model: boolean }
}

/** The fields a stored read may seed a mount with. */
export interface ModelAccessSeeded {
  modelBaseUrl: string
  model: string
}

/** Everything a Model Access surface renders from and acts on. */
export interface ModelAccessState {
  modelBaseUrl: string
  model: string
  typedKey: string
  keySet: boolean | null
  keychainProblem: string | null
  keychainRefusal: KeychainRefusal | null
  unsaved: { modelBaseUrl: boolean; model: boolean }
  /** A keystroke into the API Key field. */
  onTypeKey: (next: string) => void
  onBaseUrlChange: (next: string) => void
  onModelChange: (next: string) => void
  /** The retry of a refused Base URL / Model save: its current text afresh. */
  retryBaseUrl: () => void
  retryModel: () => void
  /** Saves the typed Key; a refused save keeps it under the cursor. */
  saveKey: () => void
  /** Takes the Key out of the Keychain, and is the only way out of one. */
  clearKey: () => void
  /** Asks the Keychain afresh, as the retry of a refused read does. */
  askKeychain: () => void
  /** The retry of a refused Keychain call, behaving like the press again. */
  retryKeychain: () => void
}
