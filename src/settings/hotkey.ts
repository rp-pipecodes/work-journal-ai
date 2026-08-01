/**
 * The Hotkey as this side of the app knows it: how a keystroke becomes the one
 * string that spells a Hotkey, and how a registration that was refused is said
 * out loud. It is not stored settings — the Hotkey is claimed from the OS
 * rather than merely remembered, so the Rust side owns both registering it and
 * remembering it, and this module sits opposite `src-tauri/src/hotkey.rs`.
 */

/**
 * Whether the Hotkey is available, and if not, why — the Rust side's
 * `HotkeyStatus`, as it arrives over the command boundary.
 */
export type HotkeyStatus =
  | { state: 'registered'; hotkey: string }
  | { state: 'unavailable'; hotkey: string; reason: string }

/**
 * The modifiers a global Hotkey can carry, in the one order the app spells
 * them, so the same combination is always the same string. `Alt` is how the OS
 * spells Option and `Cmd` how it spells Command.
 */
const MODIFIERS = [
  { held: (event: Keystroke) => event.ctrlKey, name: 'Ctrl' },
  { held: (event: Keystroke) => event.altKey, name: 'Alt' },
  { held: (event: Keystroke) => event.shiftKey, name: 'Shift' },
  { held: (event: Keystroke) => event.metaKey, name: 'Cmd' },
]

/** As much of a keyboard event as recording a Hotkey needs. */
export interface Keystroke {
  /** The physical key, so the accelerator does not depend on the layout. */
  code: string
  ctrlKey: boolean
  altKey: boolean
  metaKey: boolean
  shiftKey: boolean
}

/**
 * A keystroke as the Hotkey it would be, or null when it is not one yet: the
 * user is still holding modifiers down, pressed something a global shortcut
 * cannot take, or pressed a bare key — which, registered globally, would
 * swallow that key in every application on the machine.
 *
 * Escape is excluded on purpose: it is how the recorder is abandoned.
 */
export function hotkeyForKeystroke(event: Keystroke): string | null {
  const key = keyForCode(event.code)
  if (key === null) {
    return null
  }

  const held = MODIFIERS.filter((modifier) => modifier.held(event))
  // Shift alone is not a modifier a global shortcut can be built on: it is how
  // capital letters are typed.
  if (!held.some((modifier) => modifier.name !== 'Shift')) {
    return null
  }

  return [...held.map((modifier) => modifier.name), key].join('+')
}

/** The keys a Hotkey may end in, spelled the way an accelerator spells them. */
function keyForCode(code: string): string | null {
  const letter = /^Key([A-Z])$/.exec(code)
  if (letter !== null) {
    return letter[1]
  }

  const digit = /^Digit(\d)$/.exec(code)
  if (digit !== null) {
    return digit[1]
  }

  if (/^F\d{1,2}$/.test(code)) {
    return code
  }

  if (code === 'Space') {
    return 'Space'
  }

  return null
}

/**
 * A Hotkey that could not be registered, said plainly. It names the
 * combination and the reason, and points at the Tray Menu — the Entry Point
 * that always works — so a refused registration reads as one way in being
 * unavailable rather than as a broken app.
 */
export function describeUnavailableHotkey(
  hotkey: string,
  reason: string,
): string {
  return `${hotkey} could not be registered: ${reason}. Start a Capture from the Work Journal menu in the menu bar instead.`
}
