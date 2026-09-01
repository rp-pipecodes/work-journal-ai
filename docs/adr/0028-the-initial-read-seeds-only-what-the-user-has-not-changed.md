# The initial read seeds only what the user has not already changed

Every Settings group opens with the window's coordinated initial read
(`loadSettingsInitialState`, `SettingsInitialState.ts`) and seeds its own
state when that read lands. The window is on screen before the read does, so
a control can be pressed in the gap; that press is already in the store by
the time the read arrives, and seeding would put the older value back over
it, leaving the control and the file disagreeing with nothing to say so. The
rule is therefore: **an arriving read may only seed state the user has not
already changed.**

The one seam that carries the rule is `useSeededState` (beside
`SettingsInitialState.ts`): it seeds until the value has been set by anything
else, and hands back the "touched" ref so the parts of the read that are not
seeds — the calendars a granted Import reads, the first-run question — are
silenced by the same press. The ref is per value: each seeded state guards
itself, and a press on one never silences another's seed.

## Why

A Settings window opens before its read finishes. Waiting for the read would
make every launch stand on the settings file; deferring user writes until the
read lands would make controls lie about what they just did; and the read is
one snapshot shared by every group, so re-reading per group would not fix the
ordering either. Seeding only untouched state keeps the window immediate, the
writes immediate, and the control and the file agreeing.

## Consequences

- Every group that seeds from the initial read does so through
  `useSeededState`, never by hand: Model Access, Meeting Import, Start at
  Login and the Hotkeys all seed through it. Task Alerts only displays the
  read and has no control that changes it.
- The "touched" ref is per value, and is read (never written) by a group's
  own effects to gate the non-seed parts of the read.
- A new group that copies the old shape — a bare `.then` on the initial read
  writing state — reintroduces the bug, which is what the settings-race
  regression tests in `SettingsView.test.tsx` exist to catch.
