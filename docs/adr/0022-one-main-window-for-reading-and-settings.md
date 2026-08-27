# One Main Window holds History, Tasks View and Settings

History, Tasks View and Settings were three windows, each opened independently from the Tray Menu, so asking three questions about the journal put three windows on screen. They are now three sections of a single Main Window with a sidebar, exactly one showing at a time. The Capture and Task Creation panels are untouched: they stay the two resident windows of [0002](0002-capture-window-is-hidden-never-closed.md) and [0019](0019-task-creation-has-its-own-resident-window.md), because what justifies them — latency, and unfinished text that has to survive — is not something a sidebar can serve.

## Considered options

- **Tear-off sections**, so a section could be pulled out into its own window when side-by-side reading is wanted. Rejected: two window models to build and maintain, and a glossary obliged to describe both, for a case nobody has asked for yet. Nothing here forecloses it.
- **Merging History and Settings only**, leaving Tasks View a separate window. Rejected: it keeps the multiple-windows complaint alive for the two surfaces most likely to be open at once, and leaves the sidebar with a hole where Tasks should be.

## Consequences

- **History and Tasks View can no longer be read side by side.** [CONTEXT.md](../../CONTEXT.md) used to justify their coexistence by the prospective/retrospective split. That split is still true and still why they are separate sections — it is no longer a claim about windows.
- **The Main Window is built on demand and genuinely closed on dismiss**, like the three windows it replaces. 0002 spent its resident-webview budget on latency, and reading back is not latency-critical; merging three windows into one does not change that arithmetic enough to buy a third resident webview.
- **A section keeps its state while another is showing; the window keeps nothing across closes.** Switching to Tasks View and back leaves the Filter exactly as it was — `Filter` is defined as changing only when the user changes it, and a sidebar click is not the user changing it. Closing the window ends the reading session, so the next Main Window opens on the most recent Occupied Day with Project = Any.
- **A clicked Task Alert now takes the one window away from whatever was on screen.** It used to open a second window and leave History alone. An Entry Point that names a section decides the section, and the alert names Tasks View.
- **A Nudge raised while Tasks View is showing waits silently on History.** No mark on the sidebar: the Tray Count is deliberately the only reminder to journal there is.
- **One size for the whole window**, rather than a size per section. A window that resized itself because the user clicked a sidebar item would be disorienting, and would have no answer at all for a window the user had already resized by hand.
- **Task Creation still floats over it.** The New Task control inside Tasks View raises the same always-on-top panel every other Task Entry Point raises. A sheet in the Main Window would be a second implementation of Task Creation, and a Draft that exists in one of them — exactly what 0019 refused.
- **The window label stops selecting the view.** Per [0003](0003-one-composition-root-one-desktop-module.md) the label picks the view; three of the five labels now collapse into one, and the section is chosen within it.
