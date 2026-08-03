import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeDesktop } from '../platform/testing/desktop'
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
