# A view is told whether it is on screen

The Main Window keeps its three sections mounted and shows one, which is what lets a Filter, a half-typed edit and an unanswered question survive a trip to another section — see [0022](0022-one-main-window-for-reading-and-settings.md). Hiding an element hides only what it holds, and a dialog, a popup or a menu is portalled to the end of the document: a confirmation opened in Tasks View stayed on screen, modal, over a History nobody could then use. Every view is now told whether it is on screen, through one context any of them can read and none of them has to be handed; a view that is not on screen closes what it portalled, and keeps everything else.

## Considered options

- **The flag Settings already had.** Settings took a prop saying whether it was the section showing. Rejected: it names the sidebar inside a section view, which 0022 refused; it has to be threaded again for every section and every dialog; and it invited the bug it caused — the prop was used to unregister the close handler, so a first run left on History recorded no answer and asked again on the next launch.
- **Unmounting the section that is not showing.** Rejected outright: it is the one thing 0022 bought, and it would take the Filter, the edit and the question with it.
- **Dropping the portal inside the shared UI primitives**, so that any overlay of a hidden view stops rendering without the view knowing. Rejected: it hides rather than dismisses — the confirmation would come back the moment the user returned to the section, still asking about a decision they walked away from — and it puts app behaviour in vendored components that are regenerated from upstream.

## Consequences

- **A view decides what leaving the screen costs it.** The seam answers one question and gives no orders. A confirmation is dismissed, because a question the user was taken away from is not one they still have open, and nothing was done to the Note or the Task. A picker is closed, because nothing is filed by closing one. The first-run question is only hidden, because it is genuinely still unanswered and Settings is where it is asked.
- **Closing the Main Window without answering the first-run question records Not now from any section.** The close handler is registered for as long as the question is unanswered, rather than for as long as Settings is showing.
- **A view rendered by a window of its own is on screen by default.** Capture and Task Creation ask nobody, and every section view is still tested exactly as it was when it had a window to itself.
- **A new overlay in a section is a new thing to take off the screen.** Nothing enforces it: a portal added without a thought for the hidden case is the same bug again, which is why the seam is one hook rather than three conventions.
