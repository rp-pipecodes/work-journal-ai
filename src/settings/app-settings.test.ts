import { afterEach, describe, expect, it, vi } from 'vitest'
import { START_AT_LOGIN_KEY } from '../platform/desktop'
import { fakeDesktop } from '../platform/testing/desktop'
import { DEFAULT_STANDUP_PROMPT, OPENAI_BASE_URL } from './settings'
import { createAppSettings } from './app-settings'

// The settings as a running window has them: the core's rules over the
// desktop's store, plus the announcements that keep the other windows honest.

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the Theme', () => {
  it('reads back what was saved, and announces it', async () => {
    const desktop = fakeDesktop()
    const settings = createAppSettings(desktop)
    const heard: string[] = []
    await desktop.onThemeChanged((theme) => heard.push(theme))

    await settings.saveTheme('dark')

    expect(await settings.loadTheme()).toBe('dark')
    expect(heard).toEqual(['dark'])
  })

  it('follows the system until the user has chosen', async () => {
    expect(await createAppSettings(fakeDesktop()).loadTheme()).toBe('system')
  })

  it('records a Theme whose announcement could not be sent', async () => {
    // The emit is what keeps the other windows honest, not what saves — a
    // failed one leaves every window repainted and the file written, and is
    // logged rather than raised, or the saver would be told a Theme was
    // refused that in truth took.
    const desktop = fakeDesktop()
    desktop.announceTheme = () => Promise.reject(new Error('the bus is gone'))
    const settings = createAppSettings(desktop)
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await settings.saveTheme('dark')

    expect(await settings.loadTheme()).toBe('dark')
  })
})

describe('start at login', () => {
  it('changes the login item and records the answer', async () => {
    const desktop = fakeDesktop()
    const settings = createAppSettings(desktop)

    await settings.saveStartAtLogin(true)

    expect(desktop.loginItem).toBe(true)
    expect((await settings.load()).startAtLogin).toBe(true)
  })

  it('removes the login item when switched off, and records it', async () => {
    const desktop = fakeDesktop()
    const settings = createAppSettings(desktop)

    await settings.saveStartAtLogin(false)

    expect(desktop.loginItem).toBe(false)
    expect((await settings.load()).startAtLogin).toBe(false)
  })

  it('records nothing the OS refused to do', async () => {
    const desktop = fakeDesktop()
    desktop.setStartAtLogin = () => Promise.reject(new Error('refused'))
    const settings = createAppSettings(desktop)

    await expect(settings.saveStartAtLogin(true)).rejects.toThrow()
    expect((await settings.load()).startAtLogin).toBe(false)
  })

  it('does not announce an older save once a newer one has landed', async () => {
    // Save A turns the login item on and starts writing the file; save B
    // turns it off while that write is still held, and B's write lands
    // first — the OS and the file both hold off. When A's write finally
    // settles it must not announce the on it was asked for: B superseded it,
    // and a control hearing A would read on while the OS and the file held
    // off. The newer save speaks for the answer that came to hold.
    const stored: Record<string, unknown> = { startAtLogin: false }
    let release = () => {}
    const firstWriteHeld = new Promise<void>((resolve) => {
      release = resolve
    })
    let writes = 0
    const desktop = fakeDesktop({
      stored,
      openSettingsStore: async () => ({
        async get<T>(key: string) {
          return stored[key] as T | undefined
        },
        async has(key: string) {
          return key in stored
        },
        async set(key: string, value: unknown) {
          stored[key] = value
          if (key === START_AT_LOGIN_KEY && ++writes === 1) {
            await firstWriteHeld
          }
        },
      }),
    })
    const settings = createAppSettings(desktop)
    const heard: boolean[] = []
    settings.onStartAtLoginChanged((next) => heard.push(next))

    const older = settings.saveStartAtLogin(true)
    await expect.poll(() => writes).toBe(1)
    await settings.saveStartAtLogin(false)

    expect(desktop.loginItem).toBe(false)
    expect(stored.startAtLogin).toBe(false)
    expect(heard).toEqual([false])

    release()
    await older

    // The older save settled after the newer one: its on stays unannounced.
    expect(heard).toEqual([false])
  })
})

describe('importing meetings', () => {
  it('reads back what was saved, and announces it to the window that sweeps', async () => {
    const desktop = fakeDesktop()
    const settings = createAppSettings(desktop)
    let announced = 0
    await desktop.onImportChanged(() => (announced += 1))

    await settings.saveImportMeetings(true)
    await settings.saveImportCalendars(['work'])

    const stored = await settings.load()
    expect(stored.importMeetings).toBe(true)
    expect(stored.importCalendars).toEqual(['work'])
    expect(announced).toBe(2)
  })

  it('is off, with nothing ticked, until the user says otherwise', async () => {
    const stored = await createAppSettings(fakeDesktop()).load()

    expect(stored.importMeetings).toBe(false)
    expect(stored.importCalendars).toEqual([])
  })

  it('announces every settled Import save with the file as it stands', async () => {
    // Save A turns Import on and starts writing the file; save B ticks a
    // calendar while that write is still held, and B's write lands first.
    // Both speak when they settle — each announcement re-reads the file, so
    // no payload can be a superseded answer — and the last one heard is the
    // last write to have landed, whatever order the saves started in.
    const stored: Record<string, unknown> = {}
    let release = () => {}
    const firstWriteHeld = new Promise<void>((resolve) => {
      release = resolve
    })
    let writes = 0
    const desktop = fakeDesktop({
      stored,
      openSettingsStore: async () => ({
        async get<T>(key: string) {
          return stored[key] as T | undefined
        },
        async has(key: string) {
          return key in stored
        },
        async set(key: string, value: unknown) {
          // A write in flight has not landed: what the file holds is what
          // settled before it.
          if (key === 'importMeetings' && ++writes === 1) {
            await firstWriteHeld
          }
          stored[key] = value
        },
      }),
    })
    const settings = createAppSettings(desktop)
    const heard: Array<{ importMeetings: boolean; importCalendars: string[] }> =
      []
    settings.onImportChanged((imported) => heard.push(imported))

    const older = settings.saveImportMeetings(true)
    await expect.poll(() => writes).toBe(1)
    await settings.saveImportCalendars(['work'])

    // The newer save settled first and spoke the file as it stood then.
    await expect
      .poll(() => heard)
      .toEqual([{ importMeetings: false, importCalendars: ['work'] }])

    release()
    await older

    // The older save settles after it — and speaks too, with the file as it
    // stands now: listeners end agreeing with the file on both keys.
    await expect.poll(() => heard).toEqual([
      { importMeetings: false, importCalendars: ['work'] },
      { importMeetings: true, importCalendars: ['work'] },
    ])
    expect(stored.importMeetings).toBe(true)
    expect(stored.importCalendars).toEqual(['work'])
  })
  it('says a save took even when the announcement could not be sent', async () => {
    // The window that sweeps catches up at its next read; the user who
    // pressed is told what the file holds, not that an emit hiccuped.
    const desktop = fakeDesktop()
    desktop.announceImportChanged = () =>
      Promise.reject(new Error('the window is gone'))
    const settings = createAppSettings(desktop)
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await settings.saveImportMeetings(true)

    expect((await settings.load()).importMeetings).toBe(true)
  })
})

describe('Model Access', () => {
  it('announces where the model is and which model, with the Key as it stands', async () => {
    const desktop = fakeDesktop({ apiKey: 'sk-a-key' })
    const settings = createAppSettings(desktop)
    const heard: Array<{
      modelBaseUrl: string
      model: string
      keySet: boolean
    }> = []
    settings.onModelAccessChanged((access) => heard.push(access))

    await settings.saveModelBaseUrl('http://localhost:11434/v1')
    await settings.saveModel('llama3.1')

    // Every settled save speaks, with the answers as they stand then: the
    // file re-read and the Keychain asked afresh, so the Key is never a
    // payload that could go stale.
    await expect.poll(() => heard).toEqual([
      {
        modelBaseUrl: 'http://localhost:11434/v1',
        model: '',
        keySet: true,
      },
      {
        modelBaseUrl: 'http://localhost:11434/v1',
        model: 'llama3.1',
        keySet: true,
      },
    ])
  })

  it('announces a Key handed to the Keychain, and one taken out of it', async () => {
    const desktop = fakeDesktop()
    const settings = createAppSettings(desktop)
    const heard: Array<{ modelBaseUrl: string; model: string; keySet: boolean }> =
      []
    settings.onModelAccessChanged((access) => heard.push(access))

    await settings.saveApiKey('sk-a-key')
    await settings.clearApiKey()

    await expect.poll(() => heard).toEqual([
      { modelBaseUrl: OPENAI_BASE_URL, model: '', keySet: true },
      { modelBaseUrl: OPENAI_BASE_URL, model: '', keySet: false },
    ])
    // The Key is a Keychain matter, never a settings-file one.
    expect(desktop.apiKey).toBe(null)
    expect(desktop.stored.apiKey).toBeUndefined()
  })

  it('records a Key the Keychain refused to take, announcing nothing', async () => {
    const desktop = fakeDesktop({ keychainRefuses: true })
    const settings = createAppSettings(desktop)
    const heard: Array<{ modelBaseUrl: string; model: string; keySet: boolean }> =
      []
    settings.onModelAccessChanged((access) => heard.push(access))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(settings.saveApiKey('sk-a-key')).rejects.toThrow()
    // No settled save speaks for one that never landed.
    expect(heard).toEqual([])
  })

  it('says a Base URL save took even when the announcement could not be sent', async () => {
    // The mounted group catches up at its next read; the user who pressed is
    // told what the file holds, not that an emit hiccuped.
    const desktop = fakeDesktop()
    desktop.apiKeySet = () => Promise.reject(new Error('the Keychain is shut'))
    const settings = createAppSettings(desktop)
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await settings.saveModelBaseUrl('http://localhost:11434/v1')

    expect((await settings.load()).modelBaseUrl).toBe(
      'http://localhost:11434/v1',
    )
  })
})

describe('the Standup Prompt', () => {
  it('opens at the shipped prompt until the user has written their own', async () => {
    const stored = await createAppSettings(fakeDesktop()).load()

    expect(stored.standupPrompt).toBe(DEFAULT_STANDUP_PROMPT)
  })

  it('reads back what was saved', async () => {
    const desktop = fakeDesktop()
    const settings = createAppSettings(desktop)

    await settings.saveStandupPrompt('Write it in pirate speak.')

    expect((await settings.load()).standupPrompt).toBe('Write it in pirate speak.')
  })
})
