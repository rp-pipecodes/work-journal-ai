/**
 * Half of the bargain a resident window strikes with the user: a key cap and
 * what pressing it is worth. Both Capture and Task Creation teach the same two
 * keys, in the same corner of the same panel, so they say it the same way.
 *
 * Said twice and never at once — a glyph beside a verb for a reader who can see
 * the key, and the whole sentence for one who cannot, since "↵ commits" read
 * aloud is not one.
 */
export default function KeyHint({
  glyph,
  reading,
  what,
  action,
  onPress,
}: {
  glyph: string
  /** The whole sentence, for a reader who hears the panel rather than sees it. */
  reading: string
  /** The verb beside the key cap, for a reader who sees it. */
  what: string
  /**
   * What the hint does when it is also a control, named as the action rather
   * than as the key — a button called "Return creates the Task." would be
   * naming the keyboard, and a pointer never pressed Return. Given with
   * `onPress` or not at all.
   */
  action?: string
  /** Makes the hint clickable, for a hand that is on the mouse instead. */
  onPress?: () => void
}) {
  const cap = (
    <span aria-hidden="true" className="flex items-center gap-1">
      <kbd className="rounded-sm border border-border bg-muted px-1 py-px font-sans type-micro leading-none text-muted-foreground">
        {glyph}
      </kbd>
      {what}
    </span>
  )

  // A hint that is only a hint stays out of the pointer's way entirely: the
  // cluster it sits in is `pointer-events-none` so a click near the field's
  // right edge still lands in the field.
  if (onPress === undefined) {
    return (
      <>
        <span className="sr-only">{reading}</span>
        {cap}
      </>
    )
  }

  return (
    <button
      type="button"
      aria-label={action}
      onClick={onPress}
      className="pointer-events-auto flex items-center gap-1 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
    >
      {cap}
    </button>
  )
}
