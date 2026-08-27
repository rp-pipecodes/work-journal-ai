# The capture window is hidden, never closed

The capture window is created once at startup and thereafter only ever shown and hidden. Dismissing it calls `hide()`; nothing calls `close()` or `destroy()`. The Main Window behaves the opposite way — it is created on demand and genuinely closed, taking History, Tasks View and Settings with it.

## Why

Latency is the product. The app exists so a thought can be recorded before it escapes, and creating a window means booting a webview, which costs a few hundred milliseconds of blank frame between the keystroke and a usable text field. `hide()`/`show()` is effectively instant. Per Tauri's API reference, `close()` and `destroy()` tear the window down along with its webview and JS context; only `hide()` keeps it alive.

## Consequences

- **This looks like a resource leak and isn't.** A live-but-invisible webview sits in memory for the entire uptime of the app. That is the intended trade: memory for latency.
- **Only the capture window gets this treatment.** Keeping the Main Window resident too would add an idle webview for the reading and settings surfaces, and would blow the app's own 30–50 MB budget.
- **The capture window is long-lived, so it must clear itself — on the Capture ending, never on the window being shown.** It does not get a fresh React tree per invocation. Every Capture starts from a cleared field — see `Draft` in [CONTEXT.md](../../CONTEXT.md), which is defined as nothing on purpose — but clearing is what *ending* a Capture does, so that the field is already empty by the time the window is next shown. Resetting on show was equivalent while a dismiss was the only thing that ever hid the window. It stopped being equivalent once Task Creation arrived as a second resident window: an Entry Point now hides the other one to make room for its own, with whatever is half-typed still in it, and that text has to be there when the window comes back. See [0019](0019-task-creation-has-its-own-resident-window.md).
- **The focus handback has since changed.** Dismissing a Capture no longer hides the application; it reactivates whatever was frontmost when the Capture began — see [0023](0023-the-app-enters-the-dock-only-while-the-main-window-is-open.md).
- **Focus must be requested explicitly.** The app hides its dock icon, and dock-less apps do not reliably receive focus when a window becomes visible, so showing the window calls `set_focus()` rather than assuming.
- **Showing an already-visible window is a no-op.** Because the window survives between Captures, an Entry Point reached during a Capture already in progress must not reset it: the field holds a line the user is halfway through typing.
