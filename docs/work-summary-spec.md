## Problem Statement

The current AI-generated Standup Post is written for a yesterday/today message to colleagues. It already reads Notes and Tasks, but its fixed daily scope and chat-oriented output do not help the user understand accomplishments, connections across their work, and outstanding commitments over a chosen period.

The user needs a personal Work Summary for a selected date range, with completed work separated clearly from commitments that are open now.

## Solution

Replace Standup Post with **Work Summary**, retaining the existing Main Window section and Tray Menu entry under the new name. Give the section an independent date-range control like History's, with no Project filter and an initial range of **This week** (Monday through today).

Generate a personal assessment from all Notes filed in the range, ordinary Tasks and recurring Task Occurrences completed in the range, and all currently Open Tasks. Clearly distinguish accomplishments during the selected period from current commitments. Synthesize accomplishments and related work, qualify inferred connections, and offer no unsolicited priorities or next steps.

Keep generation explicit, output temporary and read-only, and lossless source material independently copyable without AI.

## User Stories

1. As a journal user, I want Work Summary in the sidebar, so that I can review my work in its own section.
2. As a journal user, I want Work Summary in the Tray Menu, so that I can open it directly from the menu bar.
3. As a journal user, I want opening Work Summary to make no model call, so that I decide when generation occurs.
4. As a journal user, I want a date-range calendar and the same presets as History, so that I can summarize a day, week, month, or another period.
5. As a journal user, I want the initial range to be Monday through today, so that I can assess this week's work immediately.
6. As a journal user, I want Work Summary's range to be independent of History, so that navigating either section does not change the other's scope.
7. As a journal user, I want no Project filter in Work Summary, so that Notes and Tasks are considered together across my work.
8. As a journal user, I want all Notes filed in the selected range included, so that both Captured and Imported Notes contribute to the assessment.
9. As a journal user, I want Tasks completed in the selected range included, so that completed commitments count as accomplishments even without a corresponding Note.
10. As a journal user, I want completion inclusion to depend on completion date rather than Scheduled For, so that work completed early or late appears in the correct period.
11. As a journal user, I want completed recurring Task Occurrences included, so that recurring work is recognized alongside ordinary completions.
12. As a journal user, I want all currently Open Tasks included, so that outstanding commitments are visible regardless of the selected period.
13. As a journal user, I want future and Unscheduled Tasks included alongside today's and overdue Tasks, so that the summary does not hide commitments based on schedule.
14. As a journal user, I want current commitments explicitly distinguished from historical accomplishments, so that an older period does not falsely describe which Tasks were open then.
15. As a journal user, I want a recurring Task's completed occurrences and current Open occurrence represented separately, so that completed work and continuing commitments are both clear.
16. As a journal user, I want accomplishments synthesized and related work connected, so that I can understand the records without rereading every line.
17. As a journal user, I want inferred connections distinguished from recorded facts, so that plausible interpretations are not presented as certainty.
18. As a journal user, I want no unsolicited priorities or next steps, so that the summary does not invent a plan or treat overdue work as proof of importance or a blocker.
19. As a journal user, I want to generate with accomplishments alone or current commitments alone, so that either kind of information remains useful independently.
20. As a journal user, I want an empty half identified explicitly, so that missing records are not replaced by invented work.
21. As a journal user, I want completely empty input to refuse generation without a model call, so that nothing is spent on an empty request.
22. As a journal user, I want date selection and generation to work when I have Tasks but no Notes, so that Work Summary does not depend on an Occupied Day.
23. As a journal user, I want read-only generated output that I can copy, so that I can review it before using it elsewhere.
24. As a journal user, I want my range and generated result retained while I navigate Main Window sections, so that switching sections does not lose my work.
25. As a journal user, I want closing the Main Window to discard the generated result, so that summaries do not become stored journal records.
26. As a journal user, I want each result labelled with its original range and generation time, so that I know which snapshot it describes.
27. As a journal user, I want changed inputs or a changed range to mark the previous result outdated, so that old prose is never silently presented as current.
28. As a journal user, I want regeneration to remain explicit, so that edits and navigation do not trigger model calls automatically.
29. As a journal user, I want a failed regeneration to preserve the previous result, so that a temporary failure does not destroy usable output.
30. As a journal user, I want Copy Work Summary Material to copy the complete source records without AI, so that I can use them when Model Access is missing or unavailable.
31. As a journal user, I want clearly distinct copy actions for prose and material, so that I know which artifact reaches the clipboard.
32. As a journal user, I want Yesterday's Digest and Review Material unchanged, so that existing lossless workflows continue to work.
33. As a journal user, I want a suitable Work Summary Prompt default and continued tone/structure customization, so that the feature serves its new purpose rather than writing the old standup format.
34. As the current sole user, I want existing Standup Prompt values discarded during the transition, so that old custom instructions do not carry the obsolete purpose forward.

## Implementation Decisions

- Evolve the existing Standup Post view, material-selection/rendering module, sequencing session, settings integration, desktop model-call boundary, Main Window navigation, and Tray Menu wiring into Work Summary. Reuse established boundaries rather than creating a second AI workflow.
- The Work Summary view owns its date-range and presentation state. A session sequences reads and refreshes, following ADR 0025; it does not become a store for the view's controls.
- Reuse History's established calendar/preset behavior without sharing its selected range or Project constraint. Initialize an inclusive local-calendar range from Monday through today even when no Notes exist. Presets set a concrete range; the selection does not roll forward automatically.
- Select Notes by Journal Day. Select ordinary Completed Tasks and completed recurring Task Occurrences by Task Completed At within the local-calendar range, using the existing review-selection semantics. Scheduled For and Task Created At are not substitutes for completion time.
- Include all currently Open Tasks independently of the selected range: overdue, today, future, and Unscheduled. Preserve the distinction between a recurring Task's completed history and its current Open occurrence.
- Build Work Summary Material from the complete selected-period Notes and completions, followed by current Open Tasks. Reuse existing journal reads and lossless rendering helpers; retain original record wording and Project attribution on Notes. Do not redefine Digest or Review Material to accomplish this.
- Copy Work Summary Material replaces the former Standup Material action and remains independent of Model Access. The generated prose and material have distinct copy identities. Yesterday's Digest and Review Material retain their existing behavior.
- Generate only on an explicit action. Opening the section, refreshing data, changing a range, and navigating do not generate. Either nonempty input half permits generation; both empty refuses without calling the model.
- Capture the source material and selected range for each generation request. Keep the result's original range and generation time with it. Input or range changes mark it outdated rather than silently relabelling or regenerating it, including when changes occur during a pending request. A failed regeneration preserves the previous result and its provenance.
- Keep generated output read-only, copyable, and in memory for the Main Window lifetime. Navigation preserves it; closing the Main Window discards it. No summary persistence or new journal schema is needed.
- Replace the Standup Prompt setting with Work Summary Prompt and a suitable default. Old default and custom Standup Prompt values may be discarded without recovery; this permission concerns that setting, not Notes, Tasks, Model Access, or unrelated settings. Subsequent Work Summary customization persists normally and is not reset on every launch.
- Preserve the separation between factual-grounding rules and customizable tone/structure. The default summarizes accomplishments and connections, separates current commitments, identifies empty halves, qualifies inference, and avoids unsolicited priorities or next steps.
- Preserve the existing Model Access and desktop request architecture, including credential handling, explicit request failures, and the independent offline path. This feature does not change model providers or require a new external API.
- Update user-facing names and relevant domain documentation consistently. ADR 0041 records the selected-period/current-commitment distinction and revisits ADR 0034's earlier rejection of an independent review range. Retain ADR 0027's non-authoritative prose and independent lossless output principles while replacing the old daily Standup Material scope from ADR 0031.

## Testing Decisions

- Test observable behavior and public boundary contracts: selected records, model-request material, rendered labels and states, clipboard contents, and persisted settings. Do not assert component internals, session implementation details, or exact nondeterministic model prose.
- Use the existing view-level integration seam as the primary seam: a real Journal backed by the test database, a fixed clock, and the fake Desktop boundary for model responses, clipboard, and events. Existing Standup Post view tests already exercise this arrangement; extend or replace them for Work Summary rather than introducing a new harness.
- At that seam, cover initial This week selection, independent range/preset changes, no Project filter, generation only on demand, all input categories, task-only journals, either half empty, both halves empty, read-only output, and distinct offline material/prose copy actions.
- Use controlled pending model responses to verify original range/time attribution, outdated state after input or range changes, and preservation of old output after failed regeneration. Assert request counts to prove there are no automatic model calls.
- Use existing Main Window navigation tests and desktop routing coverage to verify sidebar/Tray Menu naming and destinations, preservation across section changes, and fresh state after Main Window closure/recreation. Verify native Tray Menu behavior with the existing desktop/manual verification approach where necessary.
- Add focused Journal-boundary material tests using the existing real-SQL and fixed-clock approach from Review Material and Standup Material tests. Cover inclusive date edges, refiling a Note, completion time versus schedule, ordinary and recurring completions, every Open Task schedule category, and lossless record preservation. Retain regression coverage for Yesterday's Digest and Review Material.
- Use the existing settings-store and Settings view test seams for the prompt transition: old default, custom, blank, and absent Standup Prompt values lead to the new default; later Work Summary customization survives reload; unrelated settings are retained.
- Automated model stubs prove inputs and lifecycle behavior, not semantic model quality. Review representative generated samples for accomplished work, related themes, qualified inference, separation of current commitments, and absence of unsolicited prioritization; do not make the deterministic test suite depend on a live model.

## Out of Scope

- A separate Standup Post or an additional Review Brief feature.
- Project filtering within Work Summary, or changes to History's filters.
- Reconstructing which Tasks were open at a historical point in time.
- AI-generated priorities, suggested next steps, or automatic changes to Notes and Tasks.
- Editing generated prose inside the app, persistent summary history, or converting summaries into Notes.
- Automatic generation, scheduled summaries, conversational follow-ups, or new model providers.
- Preserving or recovering old Standup Prompt text.
- Changes to the meaning or behavior of Yesterday's Digest and Review Material.

## Further Notes

This specification synthesizes the completed design discussion for this issue. The request is a replacement of purpose and scope, not simply adding Tasks to an input that previously contained only Notes: the current Standup Post already includes both.

When an older month is selected, a Task completed within that month belongs to accomplishments even if its schedule lies outside it; a Task open today belongs to current commitments, without claiming it was open that month. A recurring Task can legitimately appear in both halves through distinct occurrences.

The existing customized Standup Prompt reset is explicitly authorized by the sole current user. No journal-data deletion is requested. Implementation has not begun as part of this specification task.
