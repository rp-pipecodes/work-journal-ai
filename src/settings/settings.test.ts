import { describe, expect, it } from 'vitest'
import { DEFAULT_STANDUP_PROMPT } from '@/journal/standup-post'
import {
  DEFAULT_SETTINGS,
  hasAnsweredStartAtLogin,
  OPENAI_BASE_URL,
  readSettings,
  writeImportCalendars,
  writeImportMeetings,
  writeModel,
  writeModelBaseUrl,
  writeStandupPrompt,
  writeStartAtLogin,
  type SettingsStore,
} from './settings'

/** The store as the app sees it: keys to JSON, and nothing else. */
function emptyStore(entries: Record<string, unknown> = {}): SettingsStore & {
  written: Record<string, unknown>
} {
  const written = { ...entries }
  return {
    written,
    async get<T>(key: string) {
      return written[key] as T | undefined
    },
    async has(key: string) {
      return key in written
    },
    async set(key: string, value: unknown) {
      written[key] = value
    },
  }
}

describe('readSettings', () => {
  it('gives the shipped defaults for a store that has never been written', async () => {
    expect(await readSettings(emptyStore())).toEqual(DEFAULT_SETTINGS)
  })

  it('ships with no start at login, and with Import off and no calendar ticked', async () => {
    expect(DEFAULT_SETTINGS).toEqual({
      startAtLogin: false,
      importMeetings: false,
      importCalendars: [],
      modelBaseUrl: OPENAI_BASE_URL,
      model: '',
      standupPrompt: DEFAULT_STANDUP_PROMPT,
    })
  })

  it('reads back what was written', async () => {
    const store = emptyStore()
    await writeStartAtLogin(store, true)
    await writeImportMeetings(store, true)
    await writeImportCalendars(store, ['work', 'personal'])
    await writeModelBaseUrl(store, 'http://localhost:11434/v1')
    await writeModel(store, 'llama3.1')
    await writeStandupPrompt(store, 'Write it in pirate speak.')

    expect(await readSettings(store)).toEqual({
      startAtLogin: true,
      importMeetings: true,
      importCalendars: ['work', 'personal'],
      modelBaseUrl: 'http://localhost:11434/v1',
      model: 'llama3.1',
      standupPrompt: 'Write it in pirate speak.',
    })
  })

  it('reads no ticked calendars rather than a list that is not one', async () => {
    const store = emptyStore({ importCalendars: 'work' })

    expect((await readSettings(store)).importCalendars).toEqual([])
  })

  it('keeps only the names out of a list that holds other things too', async () => {
    const store = emptyStore({ importCalendars: ['work', 7, null] })

    expect((await readSettings(store)).importCalendars).toEqual(['work'])
  })

  it('falls back to a default rather than trusting a nonsense stored value', async () => {
    const store = emptyStore({ startAtLogin: 'yes' })

    expect(await readSettings(store)).toEqual(DEFAULT_SETTINGS)
  })

  it('starts Model Access at OpenAI with no model named', async () => {
    const settings = await readSettings(emptyStore())

    expect(settings.modelBaseUrl).toBe(OPENAI_BASE_URL)
    expect(settings.model).toBe('')
  })

  it('falls back to the OpenAI base URL rather than trusting something that is not one', async () => {
    const store = emptyStore({ modelBaseUrl: 7, model: { name: 'gpt' } })

    expect((await readSettings(store)).modelBaseUrl).toBe(OPENAI_BASE_URL)
    expect((await readSettings(store)).model).toBe('')
  })

  it('ignores a leftover dayStartHour from an older install', async () => {
    const store = emptyStore({ dayStartHour: 6, startAtLogin: true })

    expect(await readSettings(store)).toEqual({
      ...DEFAULT_SETTINGS,
      startAtLogin: true,
    })
  })
})

describe('the Standup Prompt', () => {
  it('ships with the prompt the previous ticket shipped', async () => {
    expect(DEFAULT_SETTINGS.standupPrompt).toBe(DEFAULT_STANDUP_PROMPT)
  })

  it('starts everyone at the shipped prompt rather than at silence', async () => {
    const settings = await readSettings(emptyStore())

    expect(settings.standupPrompt).toBe(DEFAULT_STANDUP_PROMPT)
  })

  it('treats a cleared field as the shipped prompt, not as an empty one', async () => {
    // The user can clear the field, and a model asked nothing does not write a
    // standup post: an empty stored prompt must become the shipped one, not
    // silence. (A whitespace-only prompt is a cleared one.)
    const store = emptyStore({ standupPrompt: '' })

    expect((await readSettings(store)).standupPrompt).toBe(DEFAULT_STANDUP_PROMPT)

    const blank = emptyStore({ standupPrompt: '   ' })
    expect((await readSettings(blank)).standupPrompt).toBe(DEFAULT_STANDUP_PROMPT)
  })

  it('reads back what was written, verbatim', async () => {
    const store = emptyStore()
    const prompt = 'Write it in pirate speak.'
    await writeStandupPrompt(store, prompt)

    expect((await readSettings(store)).standupPrompt).toBe(prompt)
  })

  it('falls back to the shipped prompt rather than trusting a non-string', async () => {
    const store = emptyStore({ standupPrompt: { text: 'write a post' } })

    expect((await readSettings(store)).standupPrompt).toBe(DEFAULT_STANDUP_PROMPT)
  })
})

describe('hasAnsweredStartAtLogin', () => {
  it('is unanswered until the question has been answered', async () => {
    const store = emptyStore()

    expect(await hasAnsweredStartAtLogin(store)).toBe(false)
  })

  it('counts declining as an answer, so the question is asked once', async () => {
    const store = emptyStore()
    await writeStartAtLogin(store, false)

    expect(await hasAnsweredStartAtLogin(store)).toBe(true)
    expect((await readSettings(store)).startAtLogin).toBe(false)
  })

  it('counts accepting as an answer too', async () => {
    const store = emptyStore()
    await writeStartAtLogin(store, true)

    expect(await hasAnsweredStartAtLogin(store)).toBe(true)
  })
})
