/**
 * The strip at the top of a window that the traffic lights sit in.
 *
 * The Main Window and its sections are built with an overlay title bar — see
 * `show_main_window` in `src-tauri/src/lib.rs` — so the webview is handed
 * the whole window, title bar included, and the close, minimise and zoom
 * buttons are drawn over its first rows. This is the room they are left: empty
 * background, the height macOS gives a title bar, and never inside anything
 * that scrolls, so what it holds clear stays clear.
 *
 * It also drags the window, because the title bar macOS still draws underneath
 * only hears the mouse until the webview is clicked into — after that the drag
 * is the webview's to ask for. The buttons' own corner is left out of it: a
 * drag region over them swallows the press meant to close the window.
 *
 * It is furniture rather than content: it says nothing, so it is hidden from
 * the accessibility tree.
 */
export default function WindowTitleBar() {
  return (
    <div data-slot="window-title-bar" aria-hidden className="flex h-7 shrink-0">
      <div className="w-20 shrink-0" />
      <div data-tauri-drag-region className="flex-1" />
    </div>
  )
}
