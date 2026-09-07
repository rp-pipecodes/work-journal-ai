import { afterEach, describe, expect, it, vi } from 'vitest'
import { START_AT_LOGIN_KEY } from '../platform/desktop'
import { fakeDesktop } from '../platform/testing/desktop'
import { DEFAULT_STANDUP_PROMPT } from './settings'
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

  it('announces an Import save in this window, newest only', async () => {
    // Save A turns Import on and starts writing the file; save B ticks a
    // calendar while that write is still held, and B's write lands first.
    // When A finally settles it must not announce the wish it was asked
    // for: B superseded it, and a control hearing A would read back over
    // the newer save's. The newer save speaks both keys together, as one
    // fact — which is what lets a mounted Settings group hear a choice the
    // Onboarding flow just saved.
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

    await expect
      .poll(() => heard)
      .toEqual([{ importMeetings: false, importCalendars: ['work'] }])

    release()
    await older

    // The older save settled after the newer one: its wish stays unannounced.
    expect(heard).toEqual([{ importMeetings: false, importCalendars: ['work'] }])
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
