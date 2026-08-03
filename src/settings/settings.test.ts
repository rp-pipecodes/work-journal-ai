import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS,
  hasAnsweredStartAtLogin,
  readSettings,
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

  it('ships with no start at login', async () => {
    expect(DEFAULT_SETTINGS).toEqual({
      startAtLogin: false,
    })
  })

  it('reads back what was written', async () => {
    const store = emptyStore()
    await writeStartAtLogin(store, true)

    expect(await readSettings(store)).toEqual({
      startAtLogin: true,
    })
  })

  it('falls back to a default rather than trusting a nonsense stored value', async () => {
    const store = emptyStore({ startAtLogin: 'yes' })

    expect(await readSettings(store)).toEqual(DEFAULT_SETTINGS)
  })

  it('ignores a leftover dayStartHour from an older install', async () => {
    const store = emptyStore({ dayStartHour: 6, startAtLogin: true })

    expect(await readSettings(store)).toEqual({ startAtLogin: true })
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
