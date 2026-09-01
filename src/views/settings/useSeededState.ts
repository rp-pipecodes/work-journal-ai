import { useCallback, useEffect, useRef, useState } from 'react'
import type { Dispatch, RefObject, SetStateAction } from 'react'
import type { SettingsInitialState } from './SettingsInitialState'

/**
 * State the window's coordinated initial read may seed — but only until the
 * user has set it. The read is a snapshot taken while the window is already on
 * screen, so a control can be pressed before the read lands; that press is
 * already in the store by the time it does, and seeding would put the older
 * value back over what the user just did, with nothing on screen saying so.
 *
 * The rule is: an arriving read may only seed state the user has not already
 * changed. The returned setter is the only way to change the value from here,
 * so any use of it counts as the user having changed it.
 *
 * The third element is the ref that remembers whether it has been changed. A
 * group whose controls change things the read also decides — the calendars a
 * granted Import reads, say, or the first-run question — reads it in its own
 * effect to silence those parts of the read too: one press anywhere in the
 * group silences the whole arriving read.
 */
export function useSeededState<T>(
  initialSettings: Promise<SettingsInitialState | null> | null,
  select: (initial: SettingsInitialState) => T,
  fallback: T,
): [T, Dispatch<SetStateAction<T>>, RefObject<boolean>] {
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
