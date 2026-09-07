import { describe, expect, it } from 'vitest'
import {
  apiKeyStatus,
  keychainRefusedLine,
  keychainRetryLabel,
  modelAccessTransportAllows,
  typeTheKeyAgainLine,
} from './model-access'

describe('the words Model Access is said in', () => {
  it('says whether a key is set, and what a refusal said', () => {
    expect(apiKeyStatus(true)).toMatch(/A key is saved/)
    expect(apiKeyStatus(false)).toMatch(/No key is saved/)
    expect(keychainRefusedLine('the keychain is locked')).toContain(
      'the keychain is locked',
    )
  })

  it('names each Keychain refusal by the press that retries it', () => {
    expect(keychainRetryLabel('save')).toBe('Try saving the API Key again')
    expect(keychainRetryLabel('clear')).toBe('Try removing the API Key again')
    expect(keychainRetryLabel('read')).toBe(
      'Try reading the API Key status again',
    )
    expect(typeTheKeyAgainLine()).toMatch(/type it again/)
  })
})

describe('modelAccessTransportAllows', () => {
  it('allows https to any host', () => {
    expect(modelAccessTransportAllows('https://api.openai.com/v1')).toBe(true)
    expect(modelAccessTransportAllows('https://localhost/v1')).toBe(true)
  })

  it('allows plaintext only to this machine own loopback', () => {
    expect(modelAccessTransportAllows('http://localhost:11434/v1')).toBe(true)
    expect(modelAccessTransportAllows('http://127.0.0.1:11434/v1')).toBe(true)
    // The rest of 127.0.0.0/8 is loopback too.
    expect(modelAccessTransportAllows('http://127.8.9.10/v1')).toBe(true)
    // A URL parses the odd spellings of a loopback address before its host is
    // read, exactly as the url crate does on the Rust side — so they are
    // allowed, not refused as a domain that merely looks numeric.
    expect(modelAccessTransportAllows('http://127.1/v1')).toBe(true)
    expect(modelAccessTransportAllows('http://2130706433/v1')).toBe(true)
    expect(modelAccessTransportAllows('http://0x7f000001/v1')).toBe(true)
    expect(modelAccessTransportAllows('http://[::1]:11434/v1')).toBe(true)
  })

  it('refuses plaintext to any other host, and anything that is not a URL', () => {
    expect(modelAccessTransportAllows('http://api.example.com/v1')).toBe(false)
    // A domain that merely ends in a loopback address is a name with a
    // foreign host in it, and is refused like any other.
    expect(modelAccessTransportAllows('http://127.0.0.1.evil.com/v1')).toBe(
      false,
    )
    expect(modelAccessTransportAllows('http://localhost.evil.com/v1')).toBe(
      false,
    )
    expect(modelAccessTransportAllows('ftp://api.example.com/v1')).toBe(false)
    expect(modelAccessTransportAllows('not a url')).toBe(false)
    expect(modelAccessTransportAllows('')).toBe(false)
  })
})
