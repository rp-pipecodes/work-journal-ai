import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS,
  DEFAULT_WORK_SUMMARY_PROMPT,
  OPENAI_BASE_URL,
  readSettings,
  writeImportCalendars,
  writeImportMeetings,
  writeModel,
  writeModelBaseUrl,
  writeWorkSummaryPrompt,
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
      workSummaryPrompt: DEFAULT_WORK_SUMMARY_PROMPT,
    })
  })

  it('reads back what was written', async () => {
    const store = emptyStore()
    await writeStartAtLogin(store, true)
    await writeImportMeetings(store, true)
    await writeImportCalendars(store, ['work', 'personal'])
    await writeModelBaseUrl(store, 'http://localhost:11434/v1')
    await writeModel(store, 'llama3.1')
    await writeWorkSummaryPrompt(store, 'Write it in pirate speak.')

    expect(await readSettings(store)).toEqual({
      startAtLogin: true,
      importMeetings: true,
      importCalendars: ['work', 'personal'],
      modelBaseUrl: 'http://localhost:11434/v1',
      model: 'llama3.1',
      workSummaryPrompt: 'Write it in pirate speak.',
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

describe('the Work Summary Prompt', () => {
  it('ships with the new Work Summary default', async () => {
    expect(DEFAULT_SETTINGS.workSummaryPrompt).toBe(
      DEFAULT_WORK_SUMMARY_PROMPT,
    )
    // A personal assessment, not yesterday's chat post: accomplishments and
    // current commitments distinguished, inference qualified, empty halves
    // identified rather than invented, no invented priorities — grounded in
    // the input throughout.
    expect(DEFAULT_WORK_SUMMARY_PROMPT).toContain('work summary')
    expect(DEFAULT_WORK_SUMMARY_PROMPT).toContain('open')
    expect(DEFAULT_WORK_SUMMARY_PROMPT).toContain('empty')
  })

  it('starts everyone at the shipped prompt rather than at silence', async () => {
    const settings = await readSettings(emptyStore())

    expect(settings.workSummaryPrompt).toBe(DEFAULT_WORK_SUMMARY_PROMPT)
  })

  it('treats a cleared field as the shipped prompt, not as an empty one', async () => {
    // The user can clear the field, and a model asked nothing does not write
    // a work summary: an empty stored prompt must become the shipped one, not
    // silence. (A whitespace-only prompt is a cleared one.)
    const store = emptyStore({ workSummaryPrompt: '' })

    expect((await readSettings(store)).workSummaryPrompt).toBe(
      DEFAULT_WORK_SUMMARY_PROMPT,
    )

    const blank = emptyStore({ workSummaryPrompt: '   ' })
    expect((await readSettings(blank)).workSummaryPrompt).toBe(
      DEFAULT_WORK_SUMMARY_PROMPT,
    )
  })

  it('reads back what was written, verbatim', async () => {
    const store = emptyStore()
    const prompt = 'Write it in pirate speak.'
    await writeWorkSummaryPrompt(store, prompt)

    expect((await readSettings(store)).workSummaryPrompt).toBe(prompt)
  })

  it('falls back to the shipped prompt rather than trusting a non-string', async () => {
    const store = emptyStore({ workSummaryPrompt: { text: 'write a summary' } })

    expect((await readSettings(store)).workSummaryPrompt).toBe(
      DEFAULT_WORK_SUMMARY_PROMPT,
    )
  })

  it.each([
    ['the old shipped default', 'You are writing a standup post'],
    ['a customized old prompt', 'Write it in pirate speak.'],
    ['a cleared old field', ''],
    ['a whitespace old field', '   '],
  ])(
    'discards a leftover Standup Prompt holding %s, reading the new default',
    async (_name, standupPrompt) => {
      // Work Summary replaced the Standup Post, so its old instructions are
      // never carried forward: whatever the legacy key holds, the new prompt
      // reads as the shipped one. See issue #238.
      const store = emptyStore({ standupPrompt })

      expect((await readSettings(store)).workSummaryPrompt).toBe(
        DEFAULT_WORK_SUMMARY_PROMPT,
      )
    },
  )

  it('keeps a Work Summary customization beside a leftover Standup Prompt', async () => {
    const store = emptyStore({
      standupPrompt: 'Write it in pirate speak.',
      workSummaryPrompt: 'Summarize tersely.',
    })

    expect((await readSettings(store)).workSummaryPrompt).toBe(
      'Summarize tersely.',
    )
  })

  it('leaves Notes, Tasks, Model Access and unrelated settings intact', async () => {
    const store = emptyStore({
      standupPrompt: 'Write it in pirate speak.',
      model: 'gpt-test',
      modelBaseUrl: 'https://api.openai.com/v1',
      startAtLogin: true,
    })

    const settings = await readSettings(store)

    expect(settings.workSummaryPrompt).toBe(DEFAULT_WORK_SUMMARY_PROMPT)
    expect(settings.model).toBe('gpt-test')
    expect(settings.modelBaseUrl).toBe('https://api.openai.com/v1')
    expect(settings.startAtLogin).toBe(true)
  })
})


