import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeDesktop } from '../platform/testing/desktop'
import { DEFAULT_DAY_START_HOUR } from '../journal/journal'
import { createAppSettings, followDayStart } from './app-settings'

// The settings as a running window has them: the core's rules over the
// desktop's store, plus the announcements that keep the other windows honest.

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the Day Start', () => {
  it('reads back what was saved', async () => {
    const settings = createAppSettings(fakeDesktop())

    await settings.saveDayStartHour(6)

    expect((await settings.load()).dayStartHour).toBe(6)
  })

  it('announces a new Day Start to the other windows', async () => {
    const desktop = fakeDesktop()
    const settings = createAppSettings(desktop)
    const heard: number[] = []
    await desktop.onDayStartChanged((hour) => heard.push(hour))

    await settings.saveDayStartHour(6)

    expect(heard).toEqual([6])
  })

  it('refuses an hour that is not a Day Start, and announces nothing', async () => {
    const desktop = fakeDesktop()
    const settings = createAppSettings(desktop)
    const heard: number[] = []
    await desktop.onDayStartChanged((hour) => heard.push(hour))

    await expect(settings.saveDayStartHour(47)).rejects.toThrow()
    expect(heard).toEqual([])
  })
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
})

describe('start at login', () => {
  it('changes the login item and records the answer', async () => {
    const desktop = fakeDesktop()
    const settings = createAppSettings(desktop)

    await settings.saveStartAtLogin(true)

    expect(desktop.loginItem).toBe(true)
    expect((await settings.load()).startAtLogin).toBe(true)
  })

  it('counts a decline as an answer, so the question is not asked again', async () => {
    const desktop = fakeDesktop()
    const settings = createAppSettings(desktop)
    expect(await settings.hasBeenAskedAboutStartAtLogin()).toBe(false)

    await settings.saveStartAtLogin(false)

    expect(desktop.loginItem).toBe(false)
    expect(await settings.hasBeenAskedAboutStartAtLogin()).toBe(true)
  })

  it('records nothing the OS refused to do', async () => {
    const desktop = fakeDesktop()
    desktop.setStartAtLogin = () => Promise.reject(new Error('refused'))
    const settings = createAppSettings(desktop)

    await expect(settings.saveStartAtLogin(true)).rejects.toThrow()
    expect(await settings.hasBeenAskedAboutStartAtLogin()).toBe(false)
  })
})

describe('following the Day Start', () => {
  it('is not ready until the stored hour is known', async () => {
    const desktop = fakeDesktop({ stored: { dayStartHour: 6 } })

    const dayStart = await followDayStart(createAppSettings(desktop))

    expect(dayStart.hour()).toBe(6)
  })

  it('moves when another window changes it', async () => {
    const desktop = fakeDesktop({ stored: { dayStartHour: 6 } })
    const dayStart = await followDayStart(createAppSettings(desktop))

    await desktop.announceDayStart(9)

    expect(dayStart.hour()).toBe(9)
  })

  it('keeps an hour announced while the stored one was still being read', async () => {
    const desktop = fakeDesktop({ stored: { dayStartHour: 6 } })
    const following = followDayStart(createAppSettings(desktop))
    // Announced before the read lands: the stored 6 is the older answer of the
    // two, and must not overwrite it.
    await desktop.announceDayStart(9)

    expect((await following).hour()).toBe(9)
  })

  it('files under the default rather than failing when the settings cannot be read', async () => {
    silenceErrors()
    const desktop = fakeDesktop({
      openSettingsStore: () => Promise.reject(new Error('no settings file')),
    })

    const dayStart = await followDayStart(createAppSettings(desktop))

    expect(dayStart.hour()).toBe(DEFAULT_DAY_START_HOUR)
  })
})

/** The failures under test are reported, not thrown; the suite is not noise. */
function silenceErrors(): void {
  vi.spyOn(console, 'error').mockImplementation(() => {})
}
