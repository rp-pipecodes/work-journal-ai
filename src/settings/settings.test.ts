import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS,
  DAY_START_HOURS,
  describeUnavailableHotkey,
  formatDayStartHour,
  hasAnsweredStartAtLogin,
  hotkeyForKeystroke,
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

describe('hotkeyForKeystroke', () => {
  const keystroke = {
    code: 'KeyJ',
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    shiftKey: false,
  }

  it('reads a modified letter as the combination it is', () => {
    expect(
      hotkeyForKeystroke({
        ...keystroke,
        ctrlKey: true,
        altKey: true,
        metaKey: true,
      }),
    ).toBe('Ctrl+Alt+Cmd+J')
  })

  it('spells the modifiers in one order, whichever were held', () => {
    expect(hotkeyForKeystroke({ ...keystroke, metaKey: true, shiftKey: true })).toBe(
      'Shift+Cmd+J',
    )
  })

  it('refuses a key held with no modifier, which would swallow typing everywhere', () => {
    expect(hotkeyForKeystroke(keystroke)).toBeNull()
    expect(hotkeyForKeystroke({ ...keystroke, shiftKey: true })).toBeNull()
  })

  it('is nothing at all while only modifiers are down', () => {
    expect(
      hotkeyForKeystroke({ ...keystroke, code: 'MetaLeft', metaKey: true }),
    ).toBeNull()
    expect(
      hotkeyForKeystroke({ ...keystroke, code: 'ShiftLeft', shiftKey: true }),
    ).toBeNull()
  })

  it('takes digits, function keys and Space', () => {
    expect(hotkeyForKeystroke({ ...keystroke, code: 'Digit7', ctrlKey: true })).toBe(
      'Ctrl+7',
    )
    expect(hotkeyForKeystroke({ ...keystroke, code: 'F5', ctrlKey: true })).toBe(
      'Ctrl+F5',
    )
    expect(hotkeyForKeystroke({ ...keystroke, code: 'Space', ctrlKey: true })).toBe(
      'Ctrl+Space',
    )
  })

  it('leaves Escape alone, because Escape dismisses the recorder', () => {
    expect(
      hotkeyForKeystroke({ ...keystroke, code: 'Escape', ctrlKey: true }),
    ).toBeNull()
  })

  it('reads the physical key, so a different layout still spells one accelerator', () => {
    expect(
      hotkeyForKeystroke({ ...keystroke, code: 'BracketLeft', ctrlKey: true }),
    ).toBeNull()
  })
})

describe('describeUnavailableHotkey', () => {
  it('says what failed, why, and where to go instead', () => {
    const message = describeUnavailableHotkey(
      'Ctrl+Alt+Cmd+J',
      'the combination belongs to another application',
    )

    expect(message).toContain('Ctrl+Alt+Cmd+J')
    expect(message).toContain('the combination belongs to another application')
    expect(message).toMatch(/menu bar|tray|work journal menu/i)
  })
})
