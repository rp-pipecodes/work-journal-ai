import { useEffect, useRef, useState } from 'react'
import { ClipboardCopyIcon, SparklesIcon } from 'lucide-react'
import WindowTitleBar from '@/components/WindowTitleBar'
import { useOnScreenToast } from '@/components/on-screen-toast'
import { Button } from '@/components/ui/button'
import { Toaster } from '@/components/ui/sonner'
import { formatJournalDay, type Clock, type Journal } from '@/journal/journal'
import {
  createStandupPostSession,
  type StandupPostState,
} from '@/journal/standup-post-session'
import {
  buildStandupMaterial,
  standupPostRefuses,
  type StandupPostSelection,
} from '@/journal/standup-post'
import type { Desktop, StandupFailure } from '@/platform/desktop'
import type { AppSettings } from '@/settings/app-settings'

/**
 * The prose a model writes from yesterday's Notes and the Tasks that still
 * stand, read before it is copied — and, beside Generate, the Standup
 * Material itself, copyable with no key, no network and no waiting (see
 * docs/adr/0031-standup-material-is-a-second-lossless-rendering.md). The
 * material is read by the session; the post itself is this view's — it lives
 * as long as the Main Window that showed it, Generate again replaces it, and
 * nothing of it is ever persisted.
 *
 * The model call is made from Rust so the API Key never enters this window —
 * see docs/adr/0026-the-api-key-lives-in-the-keychain-and-rust-makes-the-call.md.
 */
export default function StandupPostView({
  desktop,
  settings,
  journal,
  clock,
  onOpenSettings,
}: {
  desktop: Desktop
  settings: AppSettings
  journal: Promise<Journal>
  clock: Clock
  /**
   * The Model Access failure points at Settings; who hosts the switch is the
   * Main Window's to say, exactly as the sidebar's own items are.
   */
  onOpenSettings: () => void
}) {
  const [state, setState] = useState<StandupPostState>({ state: 'loading' })
  const [session] = useState(() =>
    createStandupPostSession({ journal, desktop, clock, onChange: setState }),
  )
  // The post on screen: what the model wrote, and which model wrote it — the
  // latter so a replacement post can say so. Nothing else about a call is
  // kept, and nothing here is persisted.
  const [post, setPost] = useState<{ markdown: string; model: string } | null>(null)
  // The material copy's claim, said twice — a toast for whoever is looking,
  // and a live region for whoever is not — and naming its subject: with two
  // Copy actions on this screen, an unqualified "Copied" would not say which
  // of the two things landed on the clipboard. The claim is held as the
  // selection it was made for, so it retires itself the moment the session
  // pushes another: focus, wake, a journal or Task change, and the midnight
  // rollover all re-read the selection, and a claim about material that
  // re-read may have replaced is not true anymore.
  const [materialClaim, setMaterialClaim] = useState<{
    selection: StandupPostSelection
    count: number
  } | null>(null)
  // The model being asked, while a call is in flight. Naming it is the whole
  // point: ten silent seconds read as broken without it.
  const [pending, setPending] = useState<string | null>(null)
  // Why there is no post, when there is not — one of the few kinds the call
  // answers with, rendered as one line. A previous post stays on screen.
  const [failure, setFailure] = useState<StandupFailure | null>(null)
  // The post copy's claim, the same two ways. It is view state with no
  // session behind it — the prose lives here — so this view is its only
  // retire path besides a failed copy: Generate replacing the prose.
  const [postClaim, setPostClaim] = useState<{ count: number } | null>(null)
  // What each live region says, derived, never held: '' until a copy lands
  // and gone the moment its claim is. Deriving is what retires a claim that
  // a re-read has made untrue — there is no state to forget to clear.
  const materialSaid =
    state.state === 'ready' &&
    materialClaim !== null &&
    materialClaim.selection === state.selection
      ? said(materialClaim, 'Copied the standup material to the clipboard.')
      : ''
  const postSaid =
    postClaim !== null
      ? said(postClaim, 'Copied the standup post to the clipboard.')
      : ''
  const says = useOnScreenToast()
  // A call is in flight, before the pending state has reached the button: a
  // double click must not spend the user's money twice.
  const inFlight = useRef(false)

  useEffect(() => {
    void session.start()

    return () => {
      session.stop()
    }
  }, [session])

  function onKeyDown(event: React.KeyboardEvent<HTMLElement>): void {
    if (event.key === 'Escape') void desktop.closeWindow()
  }

  /**
   * Spends the call. The material was read when the section opened; what is
   * sent is that selection's own Digest and Tasks, so the model hears exactly
   * what the section showed. Only a day with neither half is refused, and it
   * is refused here, before anything could be spent.
   */
  async function generate(): Promise<void> {
    if (state.state !== 'ready' || inFlight.current) return
    inFlight.current = true
    setFailure(null)

    try {
      const stored = await settings.load()
      // Nothing to name the pending state with and nothing the call could do:
      // Model Access is the three parts together and useless apart. Whether
      // they are there is settings validation, which lives in TypeScript —
      // see ADR 0026; Rust only holds the Key. Refused here, so the section
      // can say so and point at Settings.
      if (stored.modelBaseUrl.trim() === '' || stored.model.trim() === '') {
        setFailure({ kind: 'model-access' })
        return
      }

      if (standupPostRefuses(state.selection)) return

      setPending(stored.model)
      const response = await desktop.generateStandupPost({
        baseUrl: stored.modelBaseUrl,
        model: stored.model,
        // The user's prompt, or the shipped one whenever nothing of theirs is
        // stored — `readSettings` resolves a cleared field to the default, so
        // a model is never asked under an empty system prompt.
        systemPrompt: stored.standupPrompt,
        userContent: await buildStandupMaterial({
          journal: await journal,
          selection: state.selection,
        }),
      })

      if (response.state === 'generated') {
        setPost({ markdown: response.markdown, model: stored.model })
        // A new post retires the copy claim with the prose it was about.
        setPostClaim(null)
      } else {
        setFailure(response.failure)
      }
    } catch (error) {
      // The call's own failures arrive as `Failed` answers; this catch is
      // this window's side only — a settings file that would not open, a
      // journal read that failed — so it says so rather than blaming the
      // network.
      console.error('could not ask for a Standup Post', error)
      setFailure({ kind: 'local' })
    } finally {
      inFlight.current = false
      setPending(null)
    }
  }

  /** The post onto the clipboard, and a confirmation naming it once there. */
  async function copyPost(): Promise<void> {
    if (post === null) return

    try {
      await desktop.copyToClipboard(post.markdown)
      // A repeat of the same live copy counts up, so its region says
      // something new — a region announces on change, and identical text is
      // silence. See `said`.
      setPostClaim(postClaim !== null ? { count: postClaim.count + 1 } : { count: 1 })
      says.success('Copied the standup post to the clipboard.')
    } catch (error) {
      // A later copy that fails retires the earlier claim: the line beside
      // the button may not go on saying the opposite of the toast.
      setPostClaim(null)
      console.error('could not copy the standup post', error)
      says.failure('Could not copy the standup post.')
    }
  }

  /**
   * The Standup Material onto the clipboard, and a confirmation naming it
   * once there. No Model Access is read and no call is made: the Markdown is
   * built from the selection already on screen, so this works with no key,
   * no network and no waiting — and stays exactly as live after a post
   * exists, because the lossless rendering is there precisely when the prose
   * turns out to be wrong.
   */
  async function copyMaterial(): Promise<void> {
    if (state.state !== 'ready') return

    try {
      const material = await buildStandupMaterial({
        journal: await journal,
        selection: state.selection,
      })
      await desktop.copyToClipboard(material)
      // Claimed for this very selection: any re-read retires it by
      // construction, since a new one is a new object. A repeat of the same
      // live copy counts up; see `said`.
      setMaterialClaim(
        materialClaim !== null && materialClaim.selection === state.selection
          ? { selection: state.selection, count: materialClaim.count + 1 }
          : { selection: state.selection, count: 1 },
      )
      says.success('Copied the standup material to the clipboard.')
    } catch (error) {
      // A later copy that fails retires the earlier claim, as the post's
      // does — the line beside the button may not go on saying the opposite
      // of the toast.
      setMaterialClaim(null)
      console.error('could not copy the standup material', error)
      says.failure('Could not copy the standup material.')
    }
  }

  return (
    <div
      tabIndex={-1}
      onKeyDown={onKeyDown}
      data-section="standup-post"
      className="relative flex h-screen flex-col bg-background outline-none"
    >
      <WindowTitleBar />

      <header className="shrink-0 px-6 py-4">
        <h1 className="type-section">Standup Post</h1>
        <p className="pt-1 type-meta text-muted-foreground">
          Prose a model writes from what you did and what you still owe, for
          you to read and then paste — or yesterday as Markdown, with no key,
          no network and no waiting.
        </p>
      </header>

      <main className="flex-1 overflow-y-auto px-6 pb-5">
        {state.state === 'loading' && (
          <p role="status" className="type-meta text-muted-foreground">
            Reading the journal…
          </p>
        )}

        {state.state === 'unreadable' && (
          <p role="alert" className="type-meta text-destructive">
            Yesterday could not be read.
          </p>
        )}

        {state.state === 'ready' && (
          <div className="flex max-w-xl flex-col gap-6">
            <MaterialSummary selection={state.selection} />

            <div className="flex items-center gap-3">
              <Button
                size="sm"
                onClick={() => void generate()}
                disabled={
                  pending !== null || standupPostRefuses(state.selection)
                }
              >
                <SparklesIcon data-icon="inline-start" />
                Generate
              </Button>

              {/*
                The material as the user pastes it when there is no Model
                Access, the endpoint is down, or the prose came back wrong:
                built from the selection on screen, costing nothing and never
                waiting. It stays here, live, once a post exists — and is
                refused under the same gate as Generate, which is a day with
                nothing in either half, not anything about the model.
              */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => void copyMaterial()}
                disabled={standupPostRefuses(state.selection)}
              >
                <ClipboardCopyIcon data-icon="inline-start" />
                Copy material
              </Button>

              {/*
                The material copy's own confirmation, beside its own button
                and naming its own subject — never the post's. A repeat says
                its number: a region announces on change, so identical text
                would leave the second copy unannounced.
              */}
              <span
                role="status"
                aria-live="polite"
                className="type-meta text-muted-foreground"
              >
                {materialSaid}
              </span>

              {pending !== null && (
                <p role="status" className="type-meta text-muted-foreground">
                  Writing with {pending}…
                </p>
              )}
            </div>

            {failure !== null && (
              <FailureLine failure={failure} onOpenSettings={onOpenSettings} />
            )}

            {post !== null && (
              <section className="flex flex-col gap-2">
                <h2 className="type-section">Written by {post.model}</h2>
                <div className="rounded-md border border-border bg-card px-4 py-3 whitespace-pre-wrap type-body">
                  {post.markdown}
                </div>
                <div className="flex items-center gap-3">
                  {/* Copy post, not Copy: with a second Copy on this screen,
                      position is no longer enough to say what a button does. */}
                  <Button
                    size="sm"
                    onClick={() => void copyPost()}
                  >
                    <ClipboardCopyIcon data-icon="inline-start" />
                    Copy post
                  </Button>
                  {/* Empty until a copy lands, and announced when it does —
                      naming its subject, and numbering a repeat so identical
                      text is said again. */}
                  <span role="status" aria-live="polite" className="type-meta text-muted-foreground">
                    {postSaid}
                  </span>
                </div>
              </section>
            )}
          </div>
        )}
      </main>

      <Toaster />
    </div>
  )
}

/**
 * What the section is about to send: yesterday's date and the counts for both
 * halves. Always on screen, so the user sees what a call would spend before
 * spending it — and a day with neither half says so here, which is what makes
 * the Generate button's refusal read as an explanation rather than a mystery.
 *
 * Task Occurrences completed yesterday are counted on their own line rather
 * than folded into Completed Tasks: a Task Occurrence is not a Completed Task
 * and never joins them, so two record types that behave differently are two
 * counts.
 */
function MaterialSummary({ selection }: { selection: StandupPostSelection }) {
  return (
    <div className="flex flex-col gap-6">
      <p className="type-meta text-muted-foreground">
        Yesterday: {formatJournalDay(selection.yesterday)}
      </p>

      <section aria-labelledby="standup-yesterday-heading" className="flex flex-col gap-2">
        <h2 id="standup-yesterday-heading" className="type-section">
          Yesterday
        </h2>
        <p className="type-meta text-muted-foreground">
          {count(selection.notes.length, 'Note')}
        </p>
        <p className="type-meta text-muted-foreground">
          {count(selection.completedTasks.length, 'Completed Task')}
        </p>
        <p className="type-meta text-muted-foreground">
          {count(selection.completedOccurrences.length, 'recurring completion')}
        </p>
      </section>

      <section aria-labelledby="standup-open-heading" className="flex flex-col gap-2">
        <h2 id="standup-open-heading" className="type-section">
          Still to do
        </h2>
        <p className="type-meta text-muted-foreground">
          {count(selection.openTasks.length, 'Open Task')}
        </p>
      </section>

      {standupPostRefuses(selection) && (
        <p className="type-section text-muted-foreground">Nothing to say yet.</p>
      )}
    </div>
  )
}

/**
 * Why there is no post, as one line — the few kinds the call answers with,
 * each with its own words. Only the Model Access one is actionable here,
 * because only its fix lives in this window: the rest name what happened and
 * leave the retry to the user, who is the only one who may spend the call
 * again.
 */
function FailureLine({
  failure,
  onOpenSettings,
}: {
  failure: StandupFailure
  onOpenSettings: () => void
}) {
  return (
    <div className="flex items-start justify-between gap-6">
      <p role="alert" className="type-meta text-destructive">
        {describeFailure(failure)}
      </p>
      {failure.kind === 'model-access' && (
        <Button variant="outline" size="sm" onClick={onOpenSettings}>
          Open Settings
        </Button>
      )}
    </div>
  )
}

/**
 * One of the few lines: what happened, in the fewest words that explain it.
 * No failure is retried automatically — a model call is billable — so nothing
 * here says the app will try again; the user deciding to click Generate is
 * the retry, and the one who may spend the call.
 */
function describeFailure(failure: StandupFailure): string {
  switch (failure.kind) {
    case 'local':
      return 'Could not ask for a Standup Post. Try again.'
    case 'model-access':
      return 'Model Access is not configured. Open Settings to add a Base URL, a Model and an API Key.'
    case 'keychain':
      return 'macOS is not letting Work Journal reach the API Key in your Keychain. Unlock your login keychain and try again.'
    case 'offline':
      return 'The model could not be reached. Check your internet connection and try again.'
    case 'unauthorized':
      return 'The model refused the API Key (401). Check the Key in Settings and try again.'
    case 'rate-limited':
      return 'The model is rate limited (429). Wait a moment and try again.'
    case 'timeout':
      return 'The model took longer than 60 seconds to answer. Try again.'
    case 'other':
      return `The model answered with an error (${failure.status}). Try again.`
    case 'empty-response':
      return 'The model returned nothing. Try again.'
  }
}

function count(value: number, noun: string): string {
  return `${value} ${noun}${value === 1 ? '' : 's'}`
}

/**
 * What a copy's live region says. The same words twice are not said twice —
 * a region announces on change, so an identical repeat would be silence,
 * exactly when the reader most needs telling — so a repeat carries its own
 * number. The first copy reads plainly; the second says it is the second.
 */
function said(claim: { count: number }, text: string): string {
  return claim.count === 1 ? text : `${text} (${claim.count})`
}
