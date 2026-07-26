# Voice capture is deferred out of v1

The original specification gave voice notes equal billing with text notes: a second global shortcut, recording via the webview's `MediaRecorder`, and transcription through OpenAI. We cut it entirely from v1 and shipped text-only, because the evidence says voice is the riskiest part of the app and it drags in a disproportionate amount of everything else.

## Why

`getUserMedia` inside Tauri's macOS webview is not dependably available. There is an open wry issue for the macOS permission prompt ([wry#1195](https://github.com/tauri-apps/wry/issues/1195)), a Tauri issue for microphone access ([tauri#10898](https://github.com/tauri-apps/tauri/issues/10898)), reports of `navigator.mediaDevices` being `undefined`, and double permission prompts on macOS 14 — one at app level, one at webview level. Separately, WKWebView's `MediaRecorder` only writes `audio/mp4`/AAC; `audio/webm`, which nearly every tutorial uses, does not work in Safari. The documented escape hatch is recording natively in Rust with `cpal`.

We considered running a spike first and falling back to `cpal` if the webview failed. We chose to defer instead, because voice does not arrive alone. It brings an API key (and therefore key storage, key-status UI, and a "you have no key" warning), a `Status` lifecycle on Note — `transcribing`/`ready`/`failed` — audio staged on disk so a mid-flight quit doesn't lose a thought, a user-initiated retry path, a Vocabulary setting to fix mistranscribed names, and skip-handling in the Digest. Text-only deletes all of it. A Note simply always has a Body.

## Consequences

- `Note` has no status column. Adding voice later means a migration, and the transcription lifecycle has to be designed again from the notes in this repo's history rather than lifted from working code.
- No OpenAI key exists anywhere in v1, so no secret-handling decision was made. When voice returns, prefer the macOS Keychain over `plugin-store` (which is unencrypted, and would put a billable credential in plaintext inside Time Machine backups), and make the HTTP call from Rust so the key never enters the webview.
- If voice returns, use `gpt-4o-transcribe` and treat the model as configuration. Do not name modules after it: `whisper-1` is already absent from OpenAI's pricing page, which is exactly why the original spec's `whisper.ts`/`useWhisper.ts`/`types/whisper.ts` were a liability.
