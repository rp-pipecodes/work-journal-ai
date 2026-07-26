# Work Journal AI

A menu bar app for macOS that records what you did, one line at a time.

Press a key, type a sentence, press Enter. The window is gone before you've thought about it. Later — at standup, in a review, or as context for an LLM — you pull the day back out as Markdown.

The vocabulary used throughout this repo is defined in [CONTEXT.md](./CONTEXT.md). Decisions that will look odd without explanation are in [docs/adr/](./docs/adr/).

> **Status: v1 is text-only.** Voice notes were in the original design and were cut — see [ADR 0001](./docs/adr/0001-defer-voice-capture-to-v2.md) for the reasoning and what it would take to bring them back.

---

## 1. What it does

### Capture

Three ways in, and each one works when the others can't:

| Entry point | Notes |
|---|---|
| `Ctrl+Opt+Cmd+J` | The fast path. Three modifiers on purpose — see below. |
| Tray menu → *New Note* | The guaranteed path. Works with no special permissions. |
| Launching the app again | Focuses the running instance and opens a capture window. |

The capture window is a small floating field, focused on open. `Enter` saves and it disappears; `Escape` or clicking away discards what you typed. A Note is **one line** — no line breaks, no multi-paragraph entries. Whitespace-only input saves nothing.

**Why `Ctrl+Opt+Cmd+J` and not `Cmd+J`:** a global shortcut intercepts the keystroke before the focused app sees it, and `Cmd+J` is already Show View Options in Finder, Downloads in Chrome and Firefox, and *toggle terminal* in VS Code. Registering it globally would break your editor. Three modifiers is unclaimed. It's remappable in Settings; the default just can't be a landmine.

**Why the tray is a fallback and not a duplicate:** registering a global shortcut on macOS can require Accessibility permission, and on managed machines it may be unavailable. Every feature is reachable without the hotkey.

### History

A list of your notes, newest first, filtered by a range of Journal Days.

It opens on the **most recent day that actually has notes** — not on yesterday's date. On a Monday morning that means Friday, not an empty Sunday. If you capture your first note of the day while History is open, the list does not move under you; you get a nudge instead.

Notes can be **edited** (body and date) and **deleted**. Deletion is permanent — there is no trash. The capture timestamp is never editable; the day a note is filed under always is.

### Digest — "Copy All"

Copies every note in the current filter to the clipboard as Markdown, **oldest first** (the list reads newest-first, because that's how you scan; the digest reads oldest-first, because that's how a day reads):

```markdown
## Fri 24 Jul
- migration finally landed, rollback plan in PR 419
- pairing w/ Ana on the flaky auth test

## Mon 27 Jul
- took the on-call handover
```

Day headings appear only when the filter spans more than one day. No timestamps — nobody needs to know it was 14:03.

### Settings

- **Day Start** — the hour a Journal Day rolls over, default **04:00**. A note typed at 00:45 files under the previous day, because that's the day the work belonged to. The day is computed once at capture and stored, so changing this setting or changing timezone never rewrites your history.
- **Hotkey** — remappable. Conflicts with other *global* shortcuts can be detected; conflicts with an app's own shortcuts (like VS Code's `Cmd+J`) cannot be, so choose carefully.
- **Start at login** — off by default, offered once on first run. This app will not add itself to your login items without asking.
- **Export all to Markdown** — your escape hatch out of the SQLite file.

---

## 2. Interface

shadcn/ui on Tailwind, unstyled beyond its defaults. No design system of our own.

*(The original spec called for a Game Boy / SNES pixel-art skin built on NES.css. That was dropped: NES.css was last published in December 2019, and inheriting an abandoned framework's layout model and pixel metrics permanently isn't worth the charm.)*

---

## 3. Architecture

**Tauri v2** · **React + Vite + TypeScript** · **SQLite**

Target: macOS on Apple Silicon. Cross-platform is not a goal; Tauri makes it mostly free later if it ever becomes one.

### Windows

The **capture window is created once at startup and only ever shown and hidden** — never closed, because closing a window destroys its webview and the few hundred milliseconds of webview boot is the difference between catching a thought and losing it. History and Settings are created on demand and genuinely closed. Details and consequences in [ADR 0002](./docs/adr/0002-capture-window-is-hidden-never-closed.md).

`App.tsx` inspects the current Tauri window label and mounts the matching view, so one Vite build serves all three windows.

### Rust

`main.rs` is not "minimal" — it owns three things the frontend can't:

- **Migrations.** `plugin-sql` declares them in Rust as `Migration` structs, so the schema lives in Rust while the queries live in TypeScript. Every schema change is a recompile.
- **Single instance.** `tauri-plugin-single-instance`, registered **first** in the builder chain so a second launch exits before it can create a second tray icon or fail to register the hotkey. Its callback shows the capture window.
- **The tray icon** and menu.

### Plugins

| Plugin | For |
|---|---|
| `global-shortcut` | The capture hotkey |
| `sql` | SQLite + migrations |
| `store` | Day Start, hotkey, autostart flag — nothing secret lives here |
| `autostart` | Login item, only once the user says yes |
| `single-instance` | One process, one tray icon |

`setDockVisibility(false)` hides the dock icon. Consequence: no `Cmd+Tab`, no dock menu, so **Quit lives only in the tray**, and showing a window calls `set_focus()` explicitly because dock-less apps don't reliably get focus on their own.

### Data

One SQLite file in `~/Library/Application Support/<bundle-id>/` (`plugin-sql` resolves paths relative to `AppConfig`).

```sql
CREATE TABLE notes (
  id          TEXT PRIMARY KEY,
  body        TEXT NOT NULL,        -- one line, never empty
  captured_at TEXT NOT NULL,        -- UTC ISO-8601, immutable
  journal_day TEXT NOT NULL,        -- 'YYYY-MM-DD', decided at capture, user-editable
  edited_at   TEXT                  -- null until first edit
);
CREATE INDEX notes_journal_day ON notes (journal_day);
```

`journal_day` is stored rather than derived. That's the whole point: filters are a `BETWEEN`, the Day Start rule is applied in exactly one place, and a note captured at 22:00 in Lisbon doesn't slide to the previous day when you open the app from São Paulo.

**Backups are Time Machine's problem.** One binary file, one location, no in-app recovery, and deletion is permanent. *Export all to Markdown* is the only way out of this format — use it occasionally.

---

## 4. Project structure

```text
work-journal-ai/
├── CONTEXT.md                      # Domain vocabulary
├── docs/adr/                       # Decisions that need explaining
├── public/icons/                   # App + tray icons
├── src-tauri/
│   ├── capabilities/default.json   # Scoped plugin permissions
│   ├── icons/
│   ├── src/
│   │   ├── main.rs
│   │   └── lib.rs                  # Migrations, tray, single-instance, dock policy
│   ├── Info.plist                  # LSUIElement (no dock icon)
│   ├── tauri.conf.json
│   └── Cargo.toml
├── src/
│   ├── components/
│   │   ├── ui/                     # shadcn/ui, generated
│   │   ├── notes/
│   │   │   ├── NoteList.tsx
│   │   │   ├── NoteRow.tsx         # Inline edit + delete
│   │   │   ├── DayHeading.tsx
│   │   │   └── DateRangeFilter.tsx
│   │   └── settings/
│   │       ├── DayStartField.tsx
│   │       ├── HotkeyField.tsx
│   │       └── AutostartToggle.tsx
│   ├── hooks/
│   │   ├── useNotes.ts             # Query, create, edit, delete
│   │   ├── useSettings.ts
│   │   └── useHotkey.ts            # Register/unregister, handle denied permission
│   ├── services/
│   │   ├── db.ts                   # Queries (schema lives in Rust)
│   │   ├── journalDay.ts           # Instant + Day Start -> Journal Day. One place.
│   │   ├── digest.ts               # Notes -> Markdown
│   │   ├── export.ts               # Export all
│   │   ├── settings.ts             # plugin-store wrapper
│   │   └── window.ts               # show/hide/focus
│   ├── types/
│   │   ├── note.ts
│   │   └── settings.ts
│   ├── views/
│   │   ├── CaptureView.tsx
│   │   ├── HistoryView.tsx
│   │   └── SettingsView.tsx
│   ├── App.tsx                     # Window label -> view
│   └── main.tsx
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts
```

---

## 5. Development

Requires Node, pnpm, Xcode Command Line Tools, and a Rust toolchain:

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

```bash
pnpm install
pnpm tauri dev
```

Builds are **unsigned and unnotarized**. Gatekeeper will refuse to open a build you've moved between machines or downloaded; clear the quarantine flag:

```bash
xattr -d com.apple.quarantine /Applications/Work\ Journal.app
```

---

## 6. Not in v1

Written down so it doesn't creep back in:

- Voice capture, transcription, OpenAI API key, Vocabulary — [ADR 0001](./docs/adr/0001-defer-voice-capture-to-v2.md)
- Full-text search, tags, projects, links between notes
- AI summaries, categorisation, report generation
- Windows and Linux
- Code signing, notarization, auto-updater, any distribution channel

The eventual AI features are the reason Digest exists as a named concept: whatever generates a weekly summary will consume exactly that Markdown.

---

## License

MIT — see [LICENSE](./LICENSE).
