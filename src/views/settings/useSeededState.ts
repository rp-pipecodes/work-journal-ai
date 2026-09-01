import { useCallback, useEffect, useRef, useState } from 'react'
import type { Dispatch, RefObject, SetStateAction } from 'react'
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
 * The returned setter counts as touching it: any use of it means the user
 * has changed the value.
 *
 * The fourth element is the one other way in: restoring the value after a
 * write failed. The caller re-reads what its source still says and restores
 * the control to that — a re-read at rollback time is newer than the initial
 * snapshot, so like the setter it silences the arriving read, which must not
 * seed the older snapshot back over it. The control agrees with its source
 * whether or not a read is still coming.
 *
 * The third element is the ref that remembers whether this value has been
 * touched since the snapshot. It is per value, not per group: each seeded
 * state guards itself,
 * and a press on one never silences another's seed. What it exists for is the
 * parts of the read that are not seeds — the calendars a granted Import
 * reads, say, or the first-run question: a group reads the ref in its own
 * effect to silence those parts of the arriving read too.
 */
export function useSeededState<T>(
  initialSettings: Promise<SettingsInitialState | null> | null,
  select: (initial: SettingsInitialState) => T,
  fallback: T,
): [
  T,
  Dispatch<SetStateAction<T>>,
  RefObject<boolean>,
  (value: T) => void,
] {
  const [value, setValue] = useState(fallback)
  // The one press that silences the read. Set by the returned setter, and
  // read by the group's other effects, never written by them.
  const touched = useRef(false)

  const set = useCallback(
    (next: SetStateAction<T>) => {
      touched.current = true
      setValue(next)
    },
    [touched],
  )

  // The value after a failed write, re-read from the source. The re-read is
  // newer than the initial snapshot, so like the setter it silences the
  // arriving read: the snapshot must not be seeded back over it.
  const restore = useCallback(
    (value: T) => {
      touched.current = true
      setValue(value)
    },
    [touched],
  )

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

  return [value, set, touched, restore]
}
