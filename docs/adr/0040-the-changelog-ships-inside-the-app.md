# The changelog ships inside the app

ADR 0039 put a release's notes on the update seam, so what a version changed is read in the moment it is offered. That leaves the question unanswerable at every other moment: after the restart, the version is installed and what it changed is gone, and the reader who wants it again has to find a release page. Worse, the notes are the *next* version's — the build doing the showing is the old one, so the first update after a feature ships is the last one that cannot show it.

Work Journal now carries its own `CHANGELOG.md`, read at build time and rendered in Settings as **What's new**: the running version's entry without a press, every earlier version behind one.

## Considered options

- **A link out to `CHANGELOG.md` on GitHub.** Rejected: it needs a URL-opening capability the app does not have, it answers with whatever `main` says rather than with what this build did, and it is a network round trip and a browser window for a file the bundle can hold. A journal that works offline should be able to say what it is.
- **Fetch the changelog, or the releases, when the group is opened.** Rejected for the same reasons, plus a loading state and a failure state for a question that has a fixed answer the moment the build is made.
- **Keep the release notes as the only place, and show the installed version's notes after the restart.** Rejected: it would mean storing the notes the updater saw across a process that replaces itself, to end up with one version's entry and no way back to the one before it. The file is already the record; the app can just have it.
- **Generate a TypeScript module from `CHANGELOG.md` in a build step.** Rejected: Vite reads the file as text with `?raw`, and the parse is a dozen lines against a shape CONTRIBUTING already fixes. A generator would add a build artifact to keep in step for nothing.
- **Show every version at once.** Rejected: the list is every release there has ever been, and the question behind the group is almost always about the version just installed. One entry, and the rest a press away.

## Consequences

- **The changelog is a source file the bundle depends on.** `src/settings/changelog.ts` imports `../../CHANGELOG.md?raw`, so a malformed heading is a wrong list in the app rather than only a wrong release page. The parse keeps sections whose heading is a version and drops everything else, which is what makes `## Unreleased` — a promise about the next release — absent from a build that shipped with it.
- **`releaseNotes` reads both.** A version's bullets in the file and a release's notes in `latest.json` are the same text by construction, so they are read by the same function rather than by two that must agree.
- **A dev build opens at the newest release.** The running version is looked up in the file and the list starts there; a build whose version is not a released one, or one whose version has not been read yet, starts at the top. The question is still answered, about the release the build was cut after.
- **What a version changed is answerable offline, forever, and without a release page.** It is also answerable about versions the updater never mentioned, which is every version installed before ADR 0039 shipped.
- **A release cut without renaming `## Unreleased` shows nothing new in the app.** The workflow already refuses to build such a tag; this is the second place that convention is load-bearing.
