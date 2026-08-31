# The API key lives in the Keychain and Rust makes the call

Model Access introduces the first secret and the first network call this app has ever had. The API Key goes in the macOS Keychain, not in `tauri-plugin-store` beside the other settings, and the HTTP request is made from Rust so the key never enters the webview. `src/settings/settings.ts` opens with "Nothing here is a secret. v1 has no API key" — that sentence stops being true here, and a reader who finds a billable credential in a plaintext JSON file would rightly assume nobody thought about it.

This honours the promise already written into [0001](0001-defer-voice-capture-to-v2.md): prefer the Keychain over `plugin-store`, "which is unencrypted, and would put a billable credential in plaintext inside Time Machine backups", and "make the HTTP call from Rust so the key never enters the webview". That ADR deferred the decision along with voice; this one takes it.

## Considered options

- **`tauri-plugin-store`, like every other setting.** One store, one code path, no new dependency, and a settings module that stays honest about being plain JSON. Rejected: the file is world-readable to anything running as the user, and it is swept into every Time Machine backup and any folder-sync the user has. The cost of being wrong is somebody else's bill.
- **`tauri-plugin-http` from the webview.** The request is built where the Digest is already rendered, so nothing crosses a language boundary. Rejected: the key has to reach the webview to be sent, and the webview is where a Body the user typed, a calendar event title and a model's response all already meet.

## Consequences

- **A new dependency for the secret and a new one for the socket** — `keyring` and `reqwest` — plus an HTTP capability, in an app whose entire dependency list was local until now.
- **Settings validation stays in TypeScript and the secret stays in Rust**, so Model Access is the one setting read from two places. The command takes `{ baseUrl, model, systemPrompt, userContent }` and supplies only the key, mirroring `export_journal`, which likewise takes rendered Markdown and does the privileged part.
- **A Keychain entry outlives an uninstall**, unlike everything else the app stores, and the user must be able to clear it from Settings.
- **The Keychain can refuse.** A locked keychain or a denied prompt is an ordinary Model Access failure with a line saying why, not a crash — the same routine-path treatment Meeting Import gives a refused calendar grant.
