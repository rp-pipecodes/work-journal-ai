/**
 * The settings core: what the app remembers between runs, and every rule about
 * what a valid value is. It depends on one injected collaborator — a key-value
 * store — so it can be driven from a test without Tauri or a file on disk.
 *
 * Nothing here is a secret. Model Access brought the app its first one, and
 * the API Key is deliberately not in this file: it lives in the macOS Keychain
 * and is reached through Rust, so a plain JSON store stays acceptable for
 * everything that is here — see
 * docs/adr/0026-the-api-key-lives-in-the-keychain-and-rust-makes-the-call.md.
 */

import { START_AT_LOGIN_KEY } from '@/platform/desktop'

/** The whole of the app's settings storage: string keys to JSON values. */
export interface SettingsStore {
  get<T>(key: string): Promise<T | undefined>
  has(key: string): Promise<boolean>
  set(key: string, value: unknown): Promise<void>
}

/**
 * What the app remembers between runs, minus the Hotkey: that one is claimed
 * from the OS rather than merely stored, so the Rust side owns both registering
 * it and remembering it — see `src-tauri/src/hotkey.rs`, and `./hotkey.ts` for
 * what this side of it knows.
 *
 * Day Start is gone — see docs/adr/0005-no-day-start.md. A leftover
 * `dayStartHour` in the store is ignored.
 */
export interface Settings {
  /** Off until the user says otherwise: the app never adds itself uninvited. */
  startAtLogin: boolean
  /**
   * The user's wish for Import: whether they want today's meetings swept into
   * the journal. Off until turned on, and only ever written by the user — a
   * permission refused or revoked leaves it standing, which is what lets
   * Settings say why Import is not running, and what lets a grant restored in
   * System Settings resume it without asking a second time. Whether Import
   * actually runs is this and the OS answer together, derived where it is
   * needed. The journal keeps working exactly as before either way.
   */
  importMeetings: boolean
  /**
   * The calendars an Import reads, by identifier. None ticked by default, so
   * turning Import on sweeps nothing until the user says which calendars mean
   * work. An unticked calendar is ignored entirely.
   */
  importCalendars: string[]
  /**
   * Where the model is: any OpenAI-compatible endpoint, which is why this is a
   * field rather than a list of vendors. OpenAI's own to begin with, because a
   * default nobody has to look up is worth more than a blank box. Kept as
   * typed — the one rule on it is enforced where the key would be attached:
   * a Base URL the API Key may not travel over is refused by the model call
   * (`https`, or plaintext only to this machine's own loopback), never by
   * this store.
   */
  modelBaseUrl: string
  /**
   * Which model to ask, in the endpoint's own words. Free text, and empty
   * until the user names one: a model name baked into the app is a name that
   * outlives the model — see docs/adr/0001-defer-voice-capture-to-v2.md.
   */
  model: string
  /**
   * The system prompt a Standup Post is written under, as the user's.
   * Plain text in this store rather than a secret in the Keychain: a prompt
   * is voice, not a credential — and a consequence of the model call, not
   * something only Rust may touch. A cleared field reads back as the shipped
   * prompt, not as an empty one — see `readSettings`.
   */
  standupPrompt: string
}

/** Where Model Access points before the user points it anywhere else. */
export const OPENAI_BASE_URL = 'https://api.openai.com/v1'

/**
 * The system prompt a Standup Post is written under, as shipped — the value
 * `readSettings` falls back to while the Standup Prompt setting holds nothing
 * of the user's, and the one Restore Default puts back: see issue #133.
 * Written blind of the actual chat group, so it states the four assumptions
 * #56 settled on: two labelled sections, `#project` names kept, first person,
 * nothing stated that is absent from the input, and the input's language.
 */
export const DEFAULT_STANDUP_PROMPT = `You are writing a standup post for the user to paste into a chat group.

Write in the first person, as the user would, in the same language as the input.

Structure the post in two labelled sections: what was done yesterday, and what is planned or still to do today.

Keep #project names exactly as they appear in the input.

Say only what the input supports: state nothing that is not in it.

Keep it brief and natural, ready to paste.`

export const DEFAULT_SETTINGS: Settings = {
  startAtLogin: false,
  importMeetings: false,
  importCalendars: [],
  modelBaseUrl: OPENAI_BASE_URL,
  model: '',
  standupPrompt: DEFAULT_STANDUP_PROMPT,
}

/**
 * The store keys. The Hotkey's own key is written from Rust, and start at login
 * is imported rather than declared here because the Rust side reads that one —
 * every name shared with it lives in `src/platform/desktop.ts`.
 */
const IMPORT_MEETINGS_KEY = 'importMeetings'
const IMPORT_CALENDARS_KEY = 'importCalendars'
/**
 * The two halves of Model Access that are not secrets. The third — the API Key
 * — is never a key in this store; it is in the Keychain, and `Settings` has no
 * field for it at all.
 */
const MODEL_BASE_URL_KEY = 'modelBaseUrl'
const MODEL_KEY = 'model'
/** The prompt a Standup Post is written under. A plain setting, like the rest. */
const STANDUP_PROMPT_KEY = 'standupPrompt'

/**
 * Every setting at once, with a default wherever the store is silent or holds
 * something that is not a value at all. A settings file edited by hand, or
 * written by an older version, must not stop the app from starting.
 */
export async function readSettings(store: SettingsStore): Promise<Settings> {
  const [
    startAtLogin,
    importMeetings,
    importCalendars,
    modelBaseUrl,
    model,
    standupPrompt,
  ] = await Promise.all([
    store.get<unknown>(START_AT_LOGIN_KEY),
    store.get<unknown>(IMPORT_MEETINGS_KEY),
    store.get<unknown>(IMPORT_CALENDARS_KEY),
    store.get<unknown>(MODEL_BASE_URL_KEY),
    store.get<unknown>(MODEL_KEY),
    store.get<unknown>(STANDUP_PROMPT_KEY),
  ])

  return {
    startAtLogin:
      typeof startAtLogin === 'boolean'
        ? startAtLogin
        : DEFAULT_SETTINGS.startAtLogin,
    importMeetings:
      typeof importMeetings === 'boolean'
        ? importMeetings
        : DEFAULT_SETTINGS.importMeetings,
    // Anything that is not a list of names says nothing about which calendars
    // the user meant, and Import reading the wrong ones is worse than reading
    // none: it writes Notes the user never asked for.
    importCalendars: Array.isArray(importCalendars)
      ? importCalendars.filter((id): id is string => typeof id === 'string')
      : DEFAULT_SETTINGS.importCalendars,
    modelBaseUrl:
      typeof modelBaseUrl === 'string'
        ? modelBaseUrl
        : DEFAULT_SETTINGS.modelBaseUrl,
    model: typeof model === 'string' ? model : DEFAULT_SETTINGS.model,
    // Empty means the default, not silence: a model asked nothing does not
    // write a standup post, and a cleared field must read as the shipped
    // prompt — the same fallback a store that says nothing gets. A prompt
    // that is all whitespace is a cleared one.
    standupPrompt:
      typeof standupPrompt === 'string' && standupPrompt.trim() !== ''
        ? standupPrompt
        : DEFAULT_SETTINGS.standupPrompt,
  }
}

/** Where the model is. Kept as typed: what a valid endpoint is, is the endpoint's own answer. */
export async function writeModelBaseUrl(
  store: SettingsStore,
  modelBaseUrl: string,
): Promise<void> {
  await store.set(MODEL_BASE_URL_KEY, modelBaseUrl)
}

/** Which model to ask, in the endpoint's own words. */
export async function writeModel(
  store: SettingsStore,
  model: string,
): Promise<void> {
  await store.set(MODEL_KEY, model)
}

/**
 * The prompt a Standup Post is written under, kept as typed. A cleared field
 * is written too — the default into which it is read is the store's answer
 * to "nothing was entered" — and Restore Default writes the shipped prompt
 * back whole.
 */
export async function writeStandupPrompt(
  store: SettingsStore,
  standupPrompt: string,
): Promise<void> {
  await store.set(STANDUP_PROMPT_KEY, standupPrompt)
}

/** Whether meetings are swept at all. Both answers are the user's. */
export async function writeImportMeetings(
  store: SettingsStore,
  importMeetings: boolean,
): Promise<void> {
  await store.set(IMPORT_MEETINGS_KEY, importMeetings)
}

/** Which calendars an Import reads. An empty list is a real answer: none. */
export async function writeImportCalendars(
  store: SettingsStore,
  importCalendars: string[],
): Promise<void> {
  await store.set(IMPORT_CALENDARS_KEY, importCalendars)
}

/** Both answers are answers: declining is recorded exactly as accepting is. */
export async function writeStartAtLogin(
  store: SettingsStore,
  startAtLogin: boolean,
): Promise<void> {
  await store.set(START_AT_LOGIN_KEY, startAtLogin)
}

/**
 * Whether start at login has ever been asked about. The question is offered
 * once, on first run, and a "no" has to count — otherwise the app would ask
 * again every launch until it got the answer it wanted.
 */
export function hasAnsweredStartAtLogin(
  store: SettingsStore,
): Promise<boolean> {
  return store.has(START_AT_LOGIN_KEY)
}
