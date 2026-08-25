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
}: {
  glyph: string
  /** The whole sentence, for a reader who hears the panel rather than sees it. */
  reading: string
  /** The verb beside the key cap, for a reader who sees it. */
  what: string
}) {
  return (
    <>
      <span className="sr-only">{reading}</span>
      <span aria-hidden="true" className="flex items-center gap-1">
        <kbd className="rounded-sm border border-border bg-muted px-1 py-px font-sans type-micro leading-none text-muted-foreground">
          {glyph}
        </kbd>
        {what}
      </span>
    </>
  )
}
