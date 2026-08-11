import { describe, expect, it } from 'vitest'
import { fakeDesktop } from './testing/desktop'

describe('Desktop app identity', () => {
  for (const [build, appIdentity] of [
    ['release', { version: '0.4.0', isDevelopment: false }],
    ['development', { version: '0.4.0', isDevelopment: true }],
  ] as const) {
    it(`exposes the configured version for a ${build} build`, async () => {
      const desktop = fakeDesktop({ appIdentity })

      expect(await desktop.appIdentity()).toEqual(appIdentity)
    })
  }
})
