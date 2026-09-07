/**
 * The settings as a running window has them: the core's rules over the
 * desktop's store, and the announcements that keep the other windows honest.
 * Built from a Desktop and nothing else, so the suite drives the whole of it
 * without Tauri or a file on disk.
 *
 * It holds no rule of its own — what a valid value is, and what a store that
 * says nothing means, both stay in `settings.ts` and `theme.ts`.
 */

import type { Desktop, Unlisten } from '@/platform/desktop'
import {
  readSettings,
  writeImportCalendars,
  writeImportMeetings,
  writeModel,
  writeModelBaseUrl,
  writeStandupPrompt,
  writeStartAtLogin,
  type Settings,
  type SettingsStore,
} from './settings'
import { readTheme, writeTheme, type Theme } from './theme'

export interface AppSettings {
  /** Every setting at once, with a default wherever the store is silent. */
  load(): Promise<Settings>
  /** The Theme as it stands, or `system` until the user has chosen one. */
  loadTheme(): Promise<Theme>
  /**
   * A new Theme, remembered and announced. Every window repaints, including
   * the one the toggle was not pressed in.
   */
  saveTheme(theme: Theme): Promise<void>
  onThemeChanged(handle: (theme: Theme) => void): Promise<Unlisten>
  /**
   * The answer to start at login, acted on and then remembered. The login item
   * is changed first: an answer recorded but not honoured would leave Settings
   * claiming something the OS disagrees with. A save that lands is announced,
   * so every control reading the answer — the Settings row and the Onboarding
   * flow's step both do — reflects what the OS came to hold. Only the newest
   * save announces: the OS and the file take each wish as it is made, so an
   * older save that settles after a newer one has already been undone by it.
   */
  saveStartAtLogin(startAtLogin: boolean): Promise<void>
  /**
   * A Start at Login save landed, in this window — and is still the newest
   * one. Heard by the Settings row so a choice saved by the Onboarding flow
   * reaches the mounted section without its state being rebuilt — the answer
   * the OS holds is one fact, however many controls write it. Announced
   * after the save settles, so a departure before it settles still reaches
   * the control that stayed.
   */
  onStartAtLoginChanged(handle: (startAtLogin: boolean) => void): Unlisten
  /**
   * Whether meetings are swept and which calendars are read, remembered and
   * announced. Announced because the window that sweeps is not the window
   * this is changed in — and because the Settings group and the Onboarding
   * flow's step share this very instance: a choice saved by the flow must
   * reach the mounted section without its state being rebuilt. Every settled
   * save announces the file as it stands then, so overlapping saves resolve
   * to the last write to have landed rather than to whoever started last.
   */
  onImportChanged(
    handle: (imported: {
      importMeetings: boolean
      importCalendars: string[]
    }) => void,
  ): Unlisten
  /**
   * Whether meetings are swept, remembered and announced. Announced because
   * the window that sweeps is not the window this is changed in, and a change
   * the user just made should reach the journal now rather than at the next
   * sweep. Only the user reaches this: the sweep returns when the calendar
   * permission is gone rather than writing the wish off, so the reason
   * Settings owes the user survives.
   */
  saveImportMeetings(importMeetings: boolean): Promise<void>
  /** Which calendars an Import reads. Announced for the same reason. */
  saveImportCalendars(importCalendars: string[]): Promise<void>
  /**
   * Whether Model Access has its three parts, remembered and announced — the
   * two that are ordinary settings, and whether the Keychain holds the Key.
   * Announced because the Settings group and the Onboarding flow's step share
   * this very instance: a choice saved by the flow must reach the mounted
   * section without its state being rebuilt. Every settled save announces the
   * answers as they stand then, so overlapping saves resolve to the last
   * write to have landed rather than to whoever started last. The Key itself
   * never travels on the announcement — only whether the Keychain holds one.
   */
  onModelAccessChanged(
    handle: (access: {
      modelBaseUrl: string
      model: string
      keySet: boolean
    }) => void,
  ): Unlisten
  /** Where the model is. Stored, and announced for the reason above. */
  saveModelBaseUrl(modelBaseUrl: string): Promise<void>
  /** Which model to ask. Stored the same way, and for the same reason. */
  saveModel(model: string): Promise<void>
  /**
   * Hands the API Key to the Keychain — reached through Rust, and announced
   * as held or not once it settles, for the reason above. What the Keychain
   * holds is never read back into this window; only whether it holds one is.
   */
  saveApiKey(apiKey: string): Promise<void>
  /** Takes the API Key out of the Keychain. Announced the same way. */
  clearApiKey(): Promise<void>
  /**
   * The prompt a Standup Post is written under. Stored the same way, and for
   * the same reason: nothing but the window it was typed in is looking at it,
   * and whatever reads it next reads it when it needs it.
   */
  saveStandupPrompt(standupPrompt: string): Promise<void>
}

/**
 * An announcement that keeps the other windows honest, sent beside the write
 * it speaks for rather than as part of it. It is best-effort: what the file
 * holds is what was saved, and a failed emit — a window gone while it was
 * sent, a bus that hiccuped — is logged rather than allowed to name a saved
 * setting as refused. The window it was meant for catches up at its next
 * read: later by moments, but agreeing with the file.
 */
function emitChange(announcing: Promise<void>): void {
  void announcing.catch((error: unknown) => {
    console.error('could not announce the change to the other windows', error)
  })
}

export function createAppSettings(desktop: Desktop): AppSettings {
  // Opened once per window and shared: every setting is in the one file, and
  // the store is what makes a write reach the disk.
  let loading: Promise<SettingsStore> | null = null
  function store(): Promise<SettingsStore> {
    loading ??= desktop.openSettingsStore()
    return loading
  }

  // Who is listening for a Start at Login save, in this window. In-window
  // rather than a Desktop announcement: no other window reads the login item,
  // and the two controls that do — the Settings row and the Onboarding step —
  // share this very instance.
  const startAtLoginChanged = new Set<(startAtLogin: boolean) => void>()
  // How many Start at Login saves have been started in this window. The OS
  // and the file take each wish as it is made, so a save that started before
  // a newer one has been undone by it by the time it settles — announcing it
  // would put a superseded answer back over the newer save's. Only the save
  // that is still the newest when it settles speaks for the answer that came
  // to hold.
  let startAtLoginSaves = 0
  // Who is listening for an Import save, in this window. In-window rather
  // than a Desktop announcement, for the same reason as above: the two
  // controls that read the answer — the Settings group and the Onboarding
  // step — share this very instance.
  const importChanged = new Set<
    (imported: { importMeetings: boolean; importCalendars: string[] }) => void
  >()
  // Who is listening for a Model Access save, in this window. In-window
  // rather than a Desktop announcement, for the same reason as the Import
  // one above: the two controls that read the answer — the Settings group
  // and the Onboarding step — share this very instance.
  const modelAccessChanged = new Set<
    (access: { modelBaseUrl: string; model: string; keySet: boolean }) => void
  >()

  /**
   * Announces a settled Model Access save, with the three answers as they
   * stand now. Every settled save speaks — and each re-reads the file and
   * asks the Keychain, so its payload can never be a superseded answer: it
   * is the answers as they stand, and the last one to be heard is always
   * the last write to have landed. Best-effort, like every other
   * announcement: a refusal is logged rather than allowed to name a saved
   * setting as refused.
   */
  function announceModelAccess(): void {
    void (async () => {
      try {
        const [stored, keySet] = await Promise.all([
          readSettings(await store()),
          desktop.apiKeySet(),
        ])
        for (const handle of modelAccessChanged) {
          handle({
            modelBaseUrl: stored.modelBaseUrl,
            model: stored.model,
            keySet,
          })
        }
      } catch (error: unknown) {
        console.error(
          'could not announce the change to the other windows',
          error,
        )
      }
    })()
  }

  /**
   * Announces a settled Import save, with both keys as the file holds them
   * now. Every settled save speaks — unlike the Start at Login announcement,
   * which carries the caller's value and must stay silent once superseded,
   * this one re-reads the file, so its payload can never be a superseded
   * answer: it is the file as it stands, and the last one to be heard is
   * always the last write to have landed. Best-effort, like every other
   * announcement: a refusal is logged rather than allowed to name a saved
   * setting as refused.
   */
  function announceImport(): void {
    void (async () => {
      try {
        const stored = await readSettings(await store())
        for (const handle of importChanged) {
          handle({
            importMeetings: stored.importMeetings,
            importCalendars: stored.importCalendars,
          })
        }
      } catch (error: unknown) {
        console.error(
          'could not announce the change to the other windows',
          error,
        )
      }
    })()
  }

  return {
    async load() {
      return readSettings(await store())
    },

    async loadTheme() {
      return readTheme(await store())
    },

    async saveTheme(theme) {
      await writeTheme(await store(), theme)
      emitChange(desktop.announceTheme(theme))
    },

    onThemeChanged: (handle) => desktop.onThemeChanged(handle),

    async saveStartAtLogin(startAtLogin) {
      const save = ++startAtLoginSaves
      await desktop.setStartAtLogin(startAtLogin)
      await writeStartAtLogin(await store(), startAtLogin)
      // After it took: a save still in flight when a window departs must
      // still reach the control that stayed mounted, and a control must never
      // be told a change was saved before the OS has it — nor told about a
      // change a newer save has already undone, which is what makes an older
      // save that settles later hold its tongue.
      if (save === startAtLoginSaves) {
        for (const handle of startAtLoginChanged) handle(startAtLogin)
      }
    },

    onStartAtLoginChanged(handle) {
      startAtLoginChanged.add(handle)
      return () => {
        startAtLoginChanged.delete(handle)
      }
    },
    /**
     * An Import save landed, in this window. Heard by the Settings group so
     * a choice saved by the Onboarding flow reaches the mounted section
     * without its state being rebuilt — the wish and the ticks are one fact
     * the file holds, however many controls write it, and rebuilding would
     * throw away what else the user has unsaved in Settings. Announced after
     * the save settles, so a departure before it settles still reaches the
     * control that stayed.
     */
    onImportChanged(handle) {
      importChanged.add(handle)
      return () => {
        importChanged.delete(handle)
      }
    },

    async saveImportMeetings(importMeetings) {
      await writeImportMeetings(await store(), importMeetings)
      emitChange(desktop.announceImportChanged())
      // After it took: a save still in flight when a window departs must
      // still reach the control that stayed mounted — and every settled save
      // speaks, because each speaks the file as it stands.
      announceImport()
    },

    async saveImportCalendars(importCalendars) {
      await writeImportCalendars(await store(), importCalendars)
      emitChange(desktop.announceImportChanged())
      announceImport()
    },

    /**
     * A Model Access save landed, in this window. Heard by the Settings
     * group so a choice saved by the Onboarding flow reaches the mounted
     * section without its state being rebuilt — the Base URL, the Model and
     * the Key are one fact, however many controls write it, and rebuilding
     * would throw away what else the user has unsaved in Settings. Announced
     * after the save settles, so a departure before it settles still reaches
     * the control that stayed.
     */
    onModelAccessChanged(handle) {
      modelAccessChanged.add(handle)
      return () => {
        modelAccessChanged.delete(handle)
      }
    },

    async saveModelBaseUrl(modelBaseUrl) {
      await writeModelBaseUrl(await store(), modelBaseUrl)
      // After it took: a save still in flight when a window departs must
      // still reach the control that stayed mounted — and every settled save
      // speaks, because each speaks the answers as they stand.
      announceModelAccess()
    },

    async saveModel(model) {
      await writeModel(await store(), model)
      announceModelAccess()
    },

    async saveApiKey(apiKey) {
      await desktop.saveApiKey(apiKey)
      announceModelAccess()
    },

    async clearApiKey() {
      await desktop.clearApiKey()
      announceModelAccess()
    },

    async saveStandupPrompt(standupPrompt) {
      await writeStandupPrompt(await store(), standupPrompt)
    },
  }
}
