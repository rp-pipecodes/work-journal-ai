import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

interface TauriConfig {
  bundle?: {
    macOS?: {
      signingIdentity?: string
    }
  }
}

function tauriConfig(): TauriConfig {
  return JSON.parse(
    readFileSync(
      new URL('../../src-tauri/tauri.conf.json', import.meta.url),
      'utf8',
    ),
  ) as TauriConfig
}

describe('the macOS application bundle', () => {
  it('is ad-hoc signed as a complete bundle', () => {
    // A linker signature covers only the Mach-O. In that shape macOS sees the
    // executable as a generated `app-*` identity and refuses when it asks for
    // notifications on behalf of the bundle identifier. `-` is Tauri's
    // explicit ad-hoc identity: it signs the completed bundle and seals its
    // Info.plist without requiring a paid Apple signing certificate.
    expect(tauriConfig().bundle?.macOS?.signingIdentity).toBe('-')
  })
})
