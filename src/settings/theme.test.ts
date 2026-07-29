import { describe, expect, it } from 'vitest'
import {
  DEFAULT_THEME,
  THEME_CHOICES,
  describeTheme,
  isTheme,
  isThemeToggle,
  readTheme,
  resolveTheme,
  toggledTheme,
  writeTheme,
  type ThemeKeystroke,
} from './theme'
import type { SettingsStore } from './settings'

/** The store as the app sees it: keys to JSON, and nothing else. */
function emptyStore(entries: Record<string, unknown> = {}): SettingsStore {
  const written = { ...entries }
  return {
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

/** A keystroke with nothing held down, so each test names only what matters. */
function keystroke(over: Partial<ThemeKeystroke> = {}): ThemeKeystroke {
  return { key: 'd', ctrlKey: false, metaKey: false, shiftKey: false, ...over }
}

describe('readTheme', () => {
  it('follows the OS until the user says otherwise', async () => {
    expect(await readTheme(emptyStore())).toBe('system')
    expect(DEFAULT_THEME).toBe('system')
  })

  it('reads back what was written', async () => {
    const store = emptyStore()
    await writeTheme(store, 'dark')

    expect(await readTheme(store)).toBe('dark')
  })

  it('falls back to the default rather than trusting a nonsense stored value', async () => {
    expect(await readTheme(emptyStore({ theme: 'purple' }))).toBe('system')
    expect(await readTheme(emptyStore({ theme: 3 }))).toBe('system')
  })
})

describe('writeTheme', () => {
  it('refuses anything that is not a Theme', async () => {
    await expect(
      writeTheme(emptyStore(), 'purple' as never),
    ).rejects.toThrow(/Not a Theme/)
  })
})

describe('isTheme', () => {
  it('knows the three preferences and nothing else', () => {
    expect(['system', 'light', 'dark'].every(isTheme)).toBe(true)
    expect(isTheme('Dark')).toBe(false)
    expect(isTheme(null)).toBe(false)
  })
})

describe('THEME_CHOICES', () => {
  it('offers every Theme, and offers following the system first', () => {
    expect(THEME_CHOICES).toEqual(['system', 'light', 'dark'])
    expect(THEME_CHOICES.every(isTheme)).toBe(true)
  })

  it('has a label for every choice it offers', () => {
    for (const choice of THEME_CHOICES) {
      expect(describeTheme(choice)).not.toBe('')
    }
    expect(new Set(THEME_CHOICES.map(describeTheme)).size).toBe(
      THEME_CHOICES.length,
    )
  })
})

describe('describeTheme', () => {
  it('says what following the system means rather than naming the value', () => {
    expect(describeTheme('system')).toBe('Match the system')
    expect(describeTheme('light')).toBe('Light')
    expect(describeTheme('dark')).toBe('Dark')
  })
})

describe('resolveTheme', () => {
  it('asks the OS only when no preference was expressed', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })

  it('honours an expressed preference whatever the OS says', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })
})

describe('toggledTheme', () => {
  it('flips what is on screen', () => {
    expect(toggledTheme('dark', false)).toBe('light')
    expect(toggledTheme('light', true)).toBe('dark')
  })

  it('leaves the OS behind by flipping what the OS was showing', () => {
    expect(toggledTheme('system', true)).toBe('light')
    expect(toggledTheme('system', false)).toBe('dark')
  })
})

describe('isThemeToggle', () => {
  it('takes Cmd+Shift+D and Ctrl+Shift+D', () => {
    expect(isThemeToggle(keystroke({ metaKey: true, shiftKey: true }), false)).toBe(true)
    expect(isThemeToggle(keystroke({ ctrlKey: true, shiftKey: true }), false)).toBe(true)
  })

  it('never fires on a bare d, which is a letter someone is typing', () => {
    expect(isThemeToggle(keystroke(), false)).toBe(false)
    expect(isThemeToggle(keystroke({ shiftKey: true }), false)).toBe(false)
    expect(isThemeToggle(keystroke({ metaKey: true }), false)).toBe(false)
  })

  it('stands aside wherever text is being entered', () => {
    expect(isThemeToggle(keystroke({ metaKey: true, shiftKey: true }), true)).toBe(false)
  })

  it('does not care how the key was capitalised', () => {
    expect(isThemeToggle(keystroke({ key: 'D', metaKey: true, shiftKey: true }), false)).toBe(true)
  })

  it('ignores other keys held with the same modifiers', () => {
    expect(isThemeToggle(keystroke({ key: 'k', metaKey: true, shiftKey: true }), false)).toBe(false)
  })
})
