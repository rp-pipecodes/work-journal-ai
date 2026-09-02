/**
 * How every settings group confirms a save: the write is already in flight
 * when the press lands, so what the user is told is decided when it settles —
 * what was saved, or what could not be. The message is the caller's, because
 * the outcome is the caller's to name — "Work Journal will start at login.",
 * not "Start at login saved" (ADR 0029) — and the id is the setting's, so a
 * save per keystroke replaces the one confirmation already showing rather
 * than stacking.
 *
 * Failures are also logged, and may run the group's own answer — the flag
 * that keeps a persistent problem line up, the rollback — before the toast
 * raises, so what the user is told is agreed with what they can see.
 */
export function saySettled<T>(
  says: {
    success: (message: string, id?: string) => void
    failure: (message: string, id?: string) => void
  },
  saving: Promise<T>,
  {
    id,
    saved,
    couldNot,
    what,
    onSaved,
    onRefused,
  }: {
    /** The one toast this setting's saves replace one another in. */
    id: string
    /** What the user is told the save did. */
    saved: string
    /** What the user is told when the save was refused. */
    couldNot: string
    /** What a refusal is logged as; a refusal already said on screen may need no more. */
    what?: string
    /** What the group does when the save took, before the toast says so. */
    onSaved?: (saved: T) => void
    /** What the group does when the save was refused, before the toast says so. */
    onRefused?: (reason: unknown) => void
  },
): void {
  saving.then(
    (settled) => {
      onSaved?.(settled)
      says.success(saved, id)
    },
    (reason: unknown) => {
      if (what !== undefined) console.error(what, reason)
      onRefused?.(reason)
      says.failure(couldNot, id)
    },
  )
}
