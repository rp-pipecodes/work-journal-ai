# Settings confirms every save with a toast

Settings has no Save button and no single point where saving happens: every control writes when it is used — a keystroke into Model, a press on Start at Login, a ticked calendar — so a setting has always been in the file by the time it is on screen, and only a failure was ever said (a red line under the field, and only where a group already had one). The user who turns Import off and sees nothing is entitled to wonder whether anything happened. Every group now raises a toast when its write settles: what was saved, or what could not be and why. The toasts go through `on-screen-toast` — ADR 0024's seam, so nothing is said while Settings is off screen and nothing said survives being switched away from — and are drawn by the Toaster Settings already mounted.

## Considered options

- **A global Save button.** Rejected: it would hold every setting hostage to one action — a Theme or a hotkey takes effect the moment it is pressed, and a journal with nothing to configure per-form has no dirty state worth a footer bar. It would also raise the question of what happens to a change the user never saves, which the on-change design answers by never having half-saved state at all.
- **Announcing only failures.** Rejected: success is exactly what a silent on-change save cannot prove, and it is what the user asked for feedback about. Failures that already carry a persistent line keep it — the toast is where the user is looking, the line is what stays once the toast has faded, the same saying-twice an Export confirmation gets.
- **One toast per save.** Rejected for text fields: a save per keystroke is a save per character, and a stack of confirmations is noise claiming to be feedback. A message with a stable id replaces the one before it, so a field holds exactly one toast while it is being typed into, refreshed by each save, gone shortly after the last.

## Consequences

- **Every save says what it did, in the outcome rather than the control's state.** "Work Journal will start at login." — not "Settings saved", which would leave the user translating, and not a readback of the switch, which they can already see.
- **A text field's toast lingers while it is being typed into and follows the last keystroke**, because the write is per keystroke and the toast is replaced per save. Speed is unchanged: the toast confirms what already happened and waits for nothing.
- **`ThemeControl.setTheme` hands back the write's promise**, so the one caller that wants to describe it can. The provider still applies the palette optimistically, still logs what it logs, and every caller may ignore the promise without an unhandled rejection.
- **The Keychain's mount read still toasts nothing.** `apiKeySet` failing is something Settings says in place — the problem line — not something the user did that needs confirming; only Save and Clear, the two actions, raise toasts.
- **The shared shape is one helper, `saySettled`** — write, id, the two messages, and the group's own answer on either end. The messages stay with the caller, because the outcome is the caller's to name; what the helper owns is the order: the group's answer before the toast, so what the user is told agrees with what they can see. A group whose save is a flow of presses and asks — Import's toggle, with a permission in the middle of it — is written by hand instead.
