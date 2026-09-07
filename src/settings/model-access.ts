/**
 * The Keychain's answer to "is there an API Key?", and its refusals, said in
 * the same words wherever Model Access is offered — the Settings section and
 * the Onboarding flow's step — so one answer lives in one place.
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
 * What the far side said, whichever side that was: a Tauri command rejects
 * with the string Rust returned, and the suite throws an Error.
 */
function saidBy(error: unknown): string {
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message
  return String(error)
}
