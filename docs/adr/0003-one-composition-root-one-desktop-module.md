# One composition root, one module that knows about Tauri

`src/main.tsx` builds everything the app is made of — the Desktop, the settings, the Journal — and hands them down as props. Views take collaborators; they import no singleton and reach for no Tauri API.

The platform is one interface, `Desktop` (`src/platform/desktop.ts`), with exactly one implementation in the app: `createTauriDesktop()` (`src/platform/tauri-desktop.ts`), which is the only file in `src/` that imports `@tauri-apps/*`. The suite drives `fakeDesktop()` instead.

Every name shared with the Rust side is declared in `src/platform/desktop.ts`: the window labels, the settings file and the keys in it that Rust reads too, the database URL, and the events. A key only this side reads stays with the rest of the settings, in `src/settings/settings.ts`. The Rust side's copies live in `src-tauri/src/lib.rs`.

## Why

Six files reached for the platform, and four strings were held across the Rust/TypeScript seam by comment alone, in four different files. The journal core was carefully injectable — a Clock and a SqlDriver — and then a module-level singleton wired it up where nothing could reach, so the seam stopped short at the view.

Two adapters justify the seam: `plugin-sql` in the app, `openTestDatabase()` in the suite. There are three windows over one seam, so the leverage is real.

## Consequences

- **A view is testable without a webview.** Everything it touches arrives as a prop.
- **The Journal is handed down as a promise, not an awaited value.** The database opens after the first paint; a Capture is typed into a window that is already on screen.
- **The clipboard is the one platform call left in a view.** `copyToClipboard` is the webview's own API rather than Tauri's, and the webview only allows the write while a click is still granting user activation — which no await survives. It stays a direct import for that reason, and is handed to the History session as a collaborator like everything else.
- **Adding a platform capability means widening `Desktop`.** That is the intended friction: the interface is the list of everything the app asks of the machine it runs on.
- **The constants are still duplicated in Rust, and a drift between the two copies fails the suite.** They are one screen each rather than one screen total, and each carries a "must match" comment. `src/platform/desktop-rust.test.ts` reads `src-tauri/src/lib.rs` as text and fails when the two sides disagree. What it checks is the list it holds, plus every name a "must match" comment claims: a name declared on both sides with neither is unchecked, which is what the comment is for. The geometry constants stay unchecked on purpose: they are only the size a resident window is built at before its webview boots, and the view then fits it from the TypeScript numbers.
