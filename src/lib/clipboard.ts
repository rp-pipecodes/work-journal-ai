/**
 * The one place the app writes to the clipboard. The webview's own clipboard
 * is enough here — a Digest is text — so there is no clipboard plugin and no
 * extra capability to grant.
 *
 * The webview only allows the write while a click is still granting the page
 * user activation, and activation does not survive an await. Callers must
 * therefore already hold the text: nothing may be read, awaited or computed
 * between the click and this call.
 */
export function copyToClipboard(text: string): Promise<void> {
  return navigator.clipboard.writeText(text)
}
