# Work Journal

A personal, local-first log of short work notes captured throughout the day, so that what you did is recoverable later — at standup, in a review, or as context for an LLM.

macOS on Apple Silicon only. Everything is local: no account, no server, no network call.

The vocabulary the app and its code use is defined in [CONTEXT.md](CONTEXT.md) and is normative.

## Status

v1 is in place: Capture from every Entry Point, history over a Filter of Journal Days with the Nudge, editing, refiling and deletion, the Digest, and Settings — Day Start, Hotkey remap, Start at Login, and Export.

## Prerequisites

- Node 24+ and [pnpm](https://pnpm.io)
- A Rust toolchain via [rustup](https://rustup.rs)

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

## Development

Install dependencies, then run the app:

```bash
pnpm install
```

```bash
pnpm tauri:dev
```

There is no Dock icon and no `Cmd+Tab` entry — the app is in the menu bar. Quit it from the Tray Menu.

`pnpm tauri:dev` merges [`tauri.dev.conf.json`](src-tauri/tauri.dev.conf.json) over the release config, which swaps the bundle identifier for `com.pipecodes.work-journal.dev`. Everything the app stores — the journal database, `settings.json`, the login item — lives under the identifier, so the dev build gets its own copy and cannot touch the notes of an installed release. Plain `pnpm tauri dev` shares them; use it only when that is what you want.

Both builds can run at once, but only one of them can hold the Hotkey: whichever registers second finds it taken and reports it unavailable. Give the dev build its own combination in its Settings — that choice persists separately too.

## Tests

```bash
pnpm test
```

Vitest, run once. `pnpm test:watch` re-runs on change. OS integrations that a test could only assert mocks against are covered by [the manual checklist](docs/manual-verification.md) instead.

## Type checking and linting

```bash
pnpm build
```

```bash
pnpm lint
```

`pnpm build` runs `tsc -b` before bundling, so it doubles as the type check.

## Building locally

```bash
pnpm tauri build --bundles app
```

The result lands in `src-tauri/target/release/bundle/macos/Work Journal.app`.

## Cutting a release

Pushing a `vX.Y.Z` tag builds the DMG and publishes it as a GitHub release. The version lives in `src-tauri/tauri.conf.json` and nowhere else — the versions in `package.json` and `src-tauri/Cargo.toml` are fixed at `0.0.0` and mean nothing.

Bump it, commit, then tag the commit that carries the bump:

```bash
git tag v0.1.0 && git push origin v0.1.0
```

The workflow refuses to build if the tag and `tauri.conf.json` disagree, and runs the tests before the build, so a red suite produces no release at all. It builds for Apple Silicon only, and the DMG is unsigned — the release notes carry the `xattr` instruction below.

### Gatekeeper and the quarantine attribute

Builds are unsigned and unnotarized by design. macOS attaches a quarantine attribute to anything that arrives from another machine — via AirDrop, a download, or a shared drive — and Gatekeeper then refuses to open the app, usually with "the app is damaged and can't be opened".

Clear the attribute on the copy you received:

```bash
xattr -dr com.apple.quarantine "/Applications/Work Journal.app"
```

A build you produced locally and never moved is not quarantined and needs nothing.

## Licence

MIT — see [LICENSE](LICENSE).
