import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS,
  DAY_START_HOURS,
  formatDayStartHour,
  hasAnsweredStartAtLogin,
  readSettings,
  writeDayStartHour,
  writeStartAtLogin,
  type SettingsStore,
} from './settings'
import { DEFAULT_DAY_START_HOUR } from '../journal/journal'

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

  it('ships with a 04:00 Day Start and no start at login', async () => {
    expect(DEFAULT_SETTINGS).toEqual({
      dayStartHour: DEFAULT_DAY_START_HOUR,
      startAtLogin: false,
    })
  })

  it('reads back what was written', async () => {
    const store = emptyStore()
    await writeDayStartHour(store, 6)
    await writeStartAtLogin(store, true)

    expect(await readSettings(store)).toEqual({
      dayStartHour: 6,
      startAtLogin: true,
    })
  })

  it('falls back to a default rather than trusting a nonsense stored value', async () => {
    const store = emptyStore({ dayStartHour: 47, startAtLogin: 'yes' })

    expect(await readSettings(store)).toEqual(DEFAULT_SETTINGS)
  })

  it('accepts midnight as a Day Start', async () => {
    const store = emptyStore()
    await writeDayStartHour(store, 0)

    expect((await readSettings(store)).dayStartHour).toBe(0)
  })
})

describe('writeDayStartHour', () => {
  it('refuses an hour that is not one of the day', async () => {
    const store = emptyStore()

    await expect(writeDayStartHour(store, 24)).rejects.toThrow(/day start/i)
    await expect(writeDayStartHour(store, -1)).rejects.toThrow(/day start/i)
    await expect(writeDayStartHour(store, 4.5)).rejects.toThrow(/day start/i)
    expect(store.written).toEqual({})
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

describe('DAY_START_HOURS', () => {
  it('offers every hour of the day, midnight first', async () => {
    expect(DAY_START_HOURS).toHaveLength(24)
    expect(DAY_START_HOURS[0]).toBe(0)
    expect(DAY_START_HOURS.at(-1)).toBe(23)
  })
})

describe('formatDayStartHour', () => {
  it('reads as a time of day, not a number', () => {
    expect(formatDayStartHour(0)).toBe('00:00')
    expect(formatDayStartHour(4)).toBe('04:00')
    expect(formatDayStartHour(23)).toBe('23:00')
  })
})
