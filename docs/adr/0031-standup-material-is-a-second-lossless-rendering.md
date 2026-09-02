# Standup Material is a second lossless rendering

The material a Standup Post is written from is complete — yesterday's Notes, the work kept yesterday, and the Open Tasks that still stand — but until now it only reached the user as prose a model wrote from it. A user with no Model Access, or an endpoint that is down, could not paste what the app had already assembled. Standup Material is that Markdown, copyable on its own, with no key, no network and no waiting.

That means the app now has two lossless renderings of yesterday: [Yesterday's Digest](0027-the-standup-post-never-replaces-yesterdays-digest.md), which is Notes only and lives on the Tray Menu, and Standup Material, which adds Tasks and lives in the Standup Post section. This is deliberate, and it is the alternative to the tempting fix.

## Considered options

- **Grow Yesterday's Digest to include Tasks**, leaving one lossless artifact and one prose one — exactly the two ADR 0027 argues for. Rejected: a Digest is Filter-shaped and Notes-shaped by definition, and Tasks are outside the Filter. Putting Tasks in it would make `Copy Digest` in History mean something different from `Copy Yesterday's Digest` in the Tray Menu, and would break the rule that a Digest renders what the Filter describes.
- **One Copy action in the section whose payload is the prose when there is prose and the material when there is not.** Rejected outright: a button whose output silently changes identity is worse than two buttons.
- **A third Tray Menu item for Standup Material.** Rejected: ADR 0027 already accepts two Tray items a stranger reads as redundant. Three is where that stops being defensible. The Tray keeps the floor and the door; the more complete artifact is one click further in, which is the right price for it.

## Consequences

- **ADR 0027 still holds and is not amended.** The Standup Post does not replace Yesterday's Digest, and Yesterday's Digest remains the floor — the thing that works with nothing configured at all. Standup Material is a second floor one click higher, not a replacement for either.
- **Standup Material is a superset of Yesterday's Digest by construction.** It contains that Digest verbatim rather than re-rendering the day, so the two can never disagree about yesterday's Notes. If they ever do, the Digest is right — as 0027 already says.
- **The Standup Post section has two Copy actions.** One copies a rendering that is always true; the other copies prose that may be wrong. They must be labelled so their outputs cannot be confused.
