/**
 * The lines of a release's own notes, as the app has to show them.
 *
 * `latest.json` carries the version's CHANGELOG.md section verbatim — a list
 * of plain sentences, one bullet each, written when the change landed. This
 * turns that text into the lines Settings renders and nothing more: the marker
 * belongs to the file, not to the reader, and a release that said nothing is
 * an empty list rather than a heading with no bullets under it.
 *
 * Deliberately not a Markdown renderer. The changelog's bullets are plain
 * sentences by convention — see CONTRIBUTING.md — so the whole of what the app
 * needs is the sentences, in order.
 */
export function releaseNotes(body: string | undefined): string[] {
  if (body === undefined) return []

  return body
    .split('\n')
    .map((line) => line.trim())
    // A section heading would be the version, which the control beside these
    // lines is already saying.
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line) => line.replace(/^[-*]\s+/, ''))
}
