import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject, SetStateAction } from 'react'
import type { SettingsInitialState } from './SettingsInitialState'

/**
 * State the window's coordinated initial read may seed — but only until
 * something newer than that read has set it. The read is a snapshot taken
 * while the window is already on screen, so a control can be pressed before
 * the read lands; that press is already in the store by the time it does, and
 * seeding would put the older value back over what the user just did, with
 * nothing on screen saying so.
 *
 * The rule is: an arriving read may only seed state that has not been
 * touched since the snapshot was taken — see
 * docs/adr/0028-the-initial-read-seeds-only-what-the-user-has-not-changed.md.
 *
 * The returned setter marks the value touched and hands back the rollback
 * for that one change: a function that puts the value back unless a newer
 * change has landed since. A rollback is what a save that failed uses to
 * undo its own change — the caller re-reads what its source says now (newer
 * than the initial snapshot, so the read must not seed over it) and rolls
 * back to that. A rollback from an older change is discarded once a newer
 * one has landed, so a slow re-read cannot undo a press that came after it.
 *
 * The third element is the ref that remembers whether this value has been
 * touched since the snapshot. It is per value, not per group: each seeded
 * state guards itself, and a press on one never silences another's seed.
 * What it exists for is the parts of the read that are not seeds — the
 * calendars a granted Import reads, say, or the first-run question: a group
 * reads the ref in its own effect to silence those parts of the arriving
 * read too.
 */
export function useSeededState<T>(
  initialSettings: Promise<SettingsInitialState | null> | null,
  select: (initial: SettingsInitialState) => T,
  fallback: T,
): [
  T,
  (next: SetStateAction<T>) => (value: T) => void,
  RefObject<boolean>,
] {
  const [value, setValue] = useState(fallback)
  // The one press that silences the read. Set by the returned setter, and
  // read by the group's other effects, never written by them.
  const touched = useRef(false)
  // How many changes have been made since the window opened. A rollback
  // belongs to the change that started it: it is discarded if a newer one
  // has landed by the time it resolves.
  const attempts = useRef(0)

  const set = useCallback((next: SetStateAction<T>) => {
    touched.current = true
    const attempt = ++attempts.current
    setValue(next)
    // Roll this change back, unless a newer one has landed since.
    return (value: T) => {
      if (attempts.current !== attempt) return
      setValue(value)
    }
  }, [])

  // The selector as the caller spells it this render, read when the read
  // settles rather than when the effect runs, so the effect attaches once.
  const selectRef = useRef(select)
  useEffect(() => {
    selectRef.current = select
  })

  useEffect(() => {
    if (initialSettings === null) return

    void initialSettings.then((initial) => {
      if (initial === null) return
      if (touched.current) return
      setValue(selectRef.current(initial))
    })
  }, [initialSettings, touched])

  return [value, set, touched]
}
