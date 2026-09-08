/**
 * The lines of a release's own notes, as the app has to show them.
 *
 * `latest.json` carries the version's CHANGELOG.md section and nothing else —
 * the release workflow puts it there, heading already dropped: a list of plain
 * sentences, one bullet each, written when the change landed. This turns that
 * text into the lines Settings renders and no more than that: the marker
 * belongs to the file, not to the reader.
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
    .filter((line) => line !== '')
    .map((line) => line.replace(/^-\s+/, ''))
}
