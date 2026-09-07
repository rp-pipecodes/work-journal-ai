/**
 * Model Access said once, wherever Model Access is offered — the Settings
 * section and the Onboarding flow's step — so one answer lives in one place:
 * what the Keychain says, what a refusal means, and what the app will and
 * will not do with a Base URL. The surfaces share these words and no others;
 * everything else about the two places they are said stays theirs.
 */

/**
 * Whether there is a key, said rather than shown: what the Keychain holds is
 * never read back into a window. Only ever said once the Keychain has
 * answered — there is no line for "still asking", because nothing of the key
 * is on screen until then.
 */
export function apiKeyStatus(keySet: boolean): string {
  return keySet
    ? 'A key is saved in the Keychain. Saving another replaces it.'
    : 'No key is saved. Nothing reaches a model until there is one.'
}

/**
 * A locked Keychain, or a prompt the user denied. Routine rather than broken —
 * the same treatment Meeting Import gives a refused calendar grant — and every
 * other setting carries on working. Said with what macOS said, so a locked
 * keychain and a denied prompt do not read the same.
 */
export function keychainRefusedLine(error: unknown): string {
  return `macOS is not letting Work Journal reach your Keychain, so the API Key cannot be read or changed. Unlock your login keychain in Keychain Access, or allow Work Journal when macOS asks, and try again. macOS said: ${saidBy(error)}`
}

/**
 * Which Keychain action a refusal refused, so the retry of it can behave like
 * the press again: a fresh read, a fresh save, or a fresh clear.
 */
export type KeychainRefusal = 'read' | 'save' | 'clear'

/** The retry's name, for the button that says it. */
export function keychainRetryLabel(refusal: KeychainRefusal): string {
  if (refusal === 'save') return 'Try saving the API Key again'
  if (refusal === 'clear') return 'Try removing the API Key again'
  return 'Try reading the API Key status again'
}

/**
 * What a refused Key save needs when the Key itself is gone: leaving a step
 * keeps the refusal but never the typed Key, and a retry that saved nothing
 * would be a button that does nothing. Said in the refusal's place of the
 * retry, so the user is told what to do rather than handed a no-op press.
 */
export function typeTheKeyAgainLine(): string {
  return 'The Key was not kept — type it again, then press Save to try again.'
}

/**
 * Whether the API Key may travel to a Base URL: always over https, or over
 * plaintext only to this machine's own loopback — `localhost`, any of
 * `127.0.0.0/8`, or `::1`. The mirror of the rule Rust enforces where the Key
 * would be attached (`transport_allows` in `src-tauri/src/standup.rs`), so
 * the step's status line can tell a Base URL the app will refuse from one it
 * will not — the words a user reads never promise a call the app refuses. The
 * call itself stays the one enforcement; this only keeps the on-screen claim
 * honest. Anything that is not a URL at all is refused, as it is there.
 */
export function modelAccessTransportAllows(baseUrl: string): boolean {
  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    return false
  }
  if (url.protocol === 'https:') return true
  if (url.protocol !== 'http:') return false
  const host = url.hostname
  if (host.toLowerCase() === 'localhost') return true
  // `URL` serializes an IPv6 address with the brackets `host_str` keeps on
  // the Rust side, so they come off before an address is compared; a domain
  // never parses as an IP at all.
  const address =
    host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
  const asV4 = address.split('.').map((part) => Number(part))
  if (
    asV4.length === 4 &&
    asV4.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
  ) {
    return asV4[0] === 127
  }
  return address === '::1'
}

/**
 * What the far side said, whichever side that was: a Tauri command rejects
 * with the string Rust returned, and the suite throws an Error.
 */
function saidBy(error: unknown): string {
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message
  return String(error)
}
