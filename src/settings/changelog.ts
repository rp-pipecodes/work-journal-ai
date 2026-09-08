import source from '../../CHANGELOG.md?raw'
import { releaseNotes } from '@/platform/release-notes'

/** One released version and what it changed, as the changelog records it. */
export interface ChangelogVersion {
  version: string
  /** The day it was released, as the heading wrote it. */
  date: string
  /** What changed, one sentence per line. */
  notes: string[]
}

/**
 * The changelog as a list of versions, newest first.
 *
 * Released versions only: an `## Unreleased` section is what the next release
 * is being written into, and a build carrying it is a build for which that
 * heading is a promise rather than a record.
 */
export function changelogVersions(text: string): ChangelogVersion[] {
  const versions: ChangelogVersion[] = []

  for (const section of text.split(/^## /m).slice(1)) {
    const [heading, ...body] = section.split('\n')
    // `0.12.0 — 2026-09-08`, which is the shape CONTRIBUTING asks for. A
    // heading that is not a version is not a release.
    const [version, date] = heading.split('—').map((part) => part.trim())
    if (!/^\d+\.\d+\.\d+$/.test(version)) continue

    versions.push({
      version,
      date: date ?? '',
      // The same reading the updater gives a release's notes, because it is
      // the same text: this file is where those notes come from.
      notes: releaseNotes(body.join('\n')),
    })
  }

  return versions
}

/**
 * The changelog this build shipped with — read at build time, so what a
 * version changed is answerable offline and without asking GitHub about a
 * `main` that has moved on since.
 */
export const CHANGELOG: ChangelogVersion[] = changelogVersions(source)
