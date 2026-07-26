# Work Journal AI — Project Specification

**Work Journal AI** is a lightweight, fast desktop application for daily logging of short work notes via text or voice, instantly accessible through the system tray / menu bar or global keyboard shortcuts.

---

## 1. Core Features

### Behavior and Access

* **Background Launch:** Runs as a menu bar / tray icon application on macOS and launches automatically at system startup.
* **Tray Menu:** Clicking the icon displays the following options:
* *New Text Note*
* *New Voice Note*
* *View Notes*
* *Settings*
* *Quit*

### Note Creation

The note creation interface is a unified, central view (a fast floating window, similar to macOS Spotlight):

* **Text Note (`Command + J`):**
* Opens the floating window with the text field automatically focused (*auto-focus*).
* Includes a button to switch to voice mode if the user prefers to record audio.

* **Voice Note (`Command + Shift + J`):**
* Opens the same floating window, but immediately starts recording audio from the microphone.
* Includes a secondary text field.
* Recorded audio is sent to the **OpenAI Whisper API**, and the transcribed text is saved to the local database.

### View Notes

* Opens a window listing the history of saved notes.
* **Date Filters:**
* Allows selecting a custom date range.
* **Default Logic:** If notes exist for the current day, it displays only **today's** notes. If no notes exist today, it automatically applies a filter for the **previous day**.

* **"Copy All" Action:** A button to quickly copy all text from the visible notes in the list based on the active filters.

### Settings

* **API Key Management (BYOK - Bring Your Own Key):**
* Field to enter and save the user's **OpenAI API Key**.
* Visual validation of key status (e.g., key saved / missing).
* Clear UI warning in the note creation window if the user attempts to record voice without a configured key.

* **Keyboard Shortcuts (*Hotkeys*):** Management and redefinition of global shortcuts to prevent conflicts with other system applications.

---

## 2. Design & Interface (UI/UX)

* **Retro / Pixel Art Style:** Inspired by classic **Game Boy Color** and **Super Nintendo (SNES)** games, with visual references to titles like *Pokémon* and *Super Mario*.
* **CSS Framework (NES.css):** Uses the **NES.css** library to render 8-bit/16-bit pixel-art visual components (buttons, text inputs, speech bubbles, and containers).
* **Typography:** Pixel/arcade style fonts (such as *Press Start 2P* or *Silkscreen*).

---

## 3. Technical Requirements & Architecture

* **Desktop Wrapper:** **Tauri v2**
* Final bundle size: **~10–15 MB**.
* Background RAM usage: **~30–50 MB**.
* Uses Tauri v2 native JS/TS plugins:
* `@tauri-apps/plugin-global-shortcut` (to listen for `Cmd+J` and `Cmd+Shift+J`).
* `@tauri-apps/plugin-sql` (for local database management).
* `@tauri-apps/plugin-store` (for persistent local storage of the API key and user settings).
* `@tauri-apps/plugin-autostart` (for system auto-start).
* Native Tauri *SystemTray* API for the top menu bar.

* **Frontend Stack:** **React + Vite + TypeScript**
* Built with React and TypeScript for type safety and reusable components.
* Bundled via Vite for fast builds and maximum performance in the native webview (WKWebView on macOS).

* **Database:** **SQLite**
* Fully local, lightweight, secure storage without external server dependencies.

* **Voice Recording & Transcription:**
* Audio recording in memory via the browser's native `MediaRecorder` API.
* Audio sent directly to the OpenAI Whisper API `/v1/audio/transcriptions` endpoint using the user-defined **API Key**.

* **Target Platforms:**
* **Phase 1:** macOS (**Apple Silicon / ARM64** architecture).
* **Phase 2:** Windows and Linux (*Cross-platform*).

---

## 4. Project Structure & Architecture

```text
work-journal-ai/
├── public/
│   ├── fonts/                     # Pixel fonts (e.g., PressStart2P.ttf)
│   └── icons/                     # Retro app icons & tray icons
├── src-tauri/                     # Tauri v2 (Rust Backend Configuration)
│   ├── capabilities/              # Tauri v2 permissions & capabilities
│   │   └── default.json           # Plugin permissions (SQL, Store, Shortcuts)
│   ├── icons/                     # OS build icons
│   ├── src/
│   │   └── main.rs                # Minimal Rust entry point
│   ├── tauri.conf.json            # App config (window definitions, tray, plugins)
│   └── Cargo.toml
├── src/                           # React + TypeScript Frontend
│   ├── assets/                    # Static assets & graphics
│   ├── components/                # Reusable UI Components
│   │   ├── common/                # Shared NES.css UI elements
│   │   │   ├── NesButton.tsx
│   │   │   ├── NesContainer.tsx
│   │   │   ├── NesInput.tsx
│   │   │   └── NesDialog.tsx
│   │   ├── notes/                 # Note-related UI
│   │   │   ├── NoteCard.tsx
│   │   │   ├── NoteFilter.tsx
│   │   │   ├── QuickNoteModal.tsx
│   │   │   └── VoiceRecorder.tsx
│   │   └── settings/              # Settings UI
│   │       ├── ApiKeyInput.tsx
│   │       └── HotkeyConfig.tsx
│   ├── hooks/                     # Custom React Hooks
│   │   ├── useAudioRecorder.ts    # Native MediaRecorder logic
│   │   ├── useHotkeys.ts          # Global shortcut listener bindings
│   │   ├── useNotes.ts            # CRUD interface for SQLite notes
│   │   ├── useSettings.ts         # Tauri Store state management (API key)
│   │   └── useWhisper.ts          # Speech-to-text API execution hook
│   ├── services/                  # Low-Level Business Logic & API Wrappers
│   │   ├── db.ts                  # SQLite initialization, schema, queries (@tauri-apps/plugin-sql)
│   │   ├── store.ts               # Persisted user settings (@tauri-apps/plugin-store)
│   │   ├── whisper.ts             # OpenAI Whisper API fetcher
│   │   └── window.ts              # Tauri window creation/visibility helpers
│   ├── styles/                    # Styling & Fonts
│   │   ├── fonts.css              # Pixel font face declarations
│   │   ├── nes-overrides.css      # Custom tweaks over NES.css
│   │   └── global.css             # Main styling entry point
│   ├── types/                     # TypeScript Interfaces
│   │   ├── note.ts                # Note datatypes & DB models
│   │   ├── settings.ts            # App config & hotkey types
│   │   └── whisper.ts             # OpenAI API request/response types
│   ├── views/                     # Main Views for Different Tauri Windows
│   │   ├── QuickNoteView.tsx      # Spotlight-style floating input (Text/Voice)
│   │   ├── HistoryView.tsx        # View Notes list with date filter & Copy All
│   │   └── SettingsView.tsx       # BYOK API Key & Hotkeys management
│   ├── App.tsx                    # Window router (detects active Tauri window)
│   ├── main.tsx                   # React root mount point
│   └── vite-env.d.ts
├── .gitignore
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts

```

### Architectural Highlights

* **Window Routing (`App.tsx`):** A single Vite build serves all windows. `App.tsx` detects the active Tauri window context (e.g., via window labels or query params) and dynamically mounts `QuickNoteView`, `HistoryView`, or `SettingsView`.
* **Isolated Services (`src/services/`):** Tauri plugin integrations (`plugin-sql`, `plugin-store`) are abstracted behind modular service functions to keep the React frontend decoupled from backend implementation details.
* **Granular Permissions (`src-tauri/capabilities/`):** Utilizes Tauri v2's capability configuration to strictly scope plugin permissions for maximum system security.

---

## 5. Future Expansion (AI Phase)

* Integration of Artificial Intelligence features using the same user API key (e.g., automated daily summaries, categorization, work report generation, or smart syncing).
