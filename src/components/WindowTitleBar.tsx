/**
 * The strip at the top of a window that the traffic lights sit in.
 *
 * History and Settings are built with an overlay title bar — see
 * `show_on_demand_window` in `src-tauri/src/lib.rs` — so the webview is handed
 * the whole window, title bar included, and the close, minimise and zoom
 * buttons are drawn over its first rows. This is the room they are left: empty
 * background, the height macOS gives a title bar, and never inside anything
 * that scrolls, so what it holds clear stays clear.
 *
 * It is furniture rather than content: it says nothing, so it is hidden from
 * the accessibility tree. The window is dragged by the strip natively, by the
 * title bar the OS is still drawing underneath it.
 */
export default function WindowTitleBar() {
  return <div data-slot="window-title-bar" aria-hidden className="h-7 shrink-0" />
}
