# The capture window is hidden, never closed

The capture window is created once at startup and thereafter only ever shown and hidden. Dismissing it calls `hide()`; nothing calls `close()` or `destroy()`. History and Settings behave the opposite way — they are created on demand and genuinely closed.

## Why

Latency is the product. The app exists so a thought can be recorded before it escapes, and creating a window means booting a webview, which costs a few hundred milliseconds of blank frame between the keystroke and a usable text field. `hide()`/`show()` is effectively instant. Per Tauri's API reference, `close()` and `destroy()` tear the window down along with its webview and JS context; only `hide()` keeps it alive.

## Consequences

- **This looks like a resource leak and isn't.** A live-but-invisible webview sits in memory for the entire uptime of the app. That is the intended trade: memory for latency.
- **Only the capture window gets this treatment.** Keeping History and Settings resident too would triple the idle footprint for windows opened once a day, and would blow the app's own 30–50 MB budget.
- **The capture window is long-lived, so it must reset itself on show.** It does not get a fresh React tree per invocation. Every Capture starts from a cleared field — see `Draft` in [CONTEXT.md](../../CONTEXT.md), which is defined as nothing on purpose.
- **Focus must be requested explicitly.** The app hides its dock icon, and dock-less apps do not reliably receive focus when a window becomes visible, so showing the window calls `set_focus()` rather than assuming. Dismissing a Capture hides the whole application in order to hand focus back, so showing it again means unhiding the application first — `show()` on a window belonging to a hidden application puts nothing on screen.
- **Showing an already-visible window is a no-op.** Because the window survives between Captures, an Entry Point reached during a Capture already in progress must not reset it: the field holds a line the user is halfway through typing.
