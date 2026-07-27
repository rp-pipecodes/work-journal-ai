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
pnpm tauri dev
```

There is no Dock icon and no `Cmd+Tab` entry — the app is in the menu bar. Quit it from the Tray Menu.

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

## Building a release

```bash
pnpm tauri build --bundles app
```

The result lands in `src-tauri/target/release/bundle/macos/Work Journal.app`.

### Gatekeeper and the quarantine attribute

Builds are unsigned and unnotarized by design. macOS attaches a quarantine attribute to anything that arrives from another machine — via AirDrop, a download, or a shared drive — and Gatekeeper then refuses to open the app, usually with "the app is damaged and can't be opened".

Clear the attribute on the copy you received:

```bash
xattr -dr com.apple.quarantine "/Applications/Work Journal.app"
```

A build you produced locally and never moved is not quarantined and needs nothing.

## Licence

MIT — see [LICENSE](LICENSE).
